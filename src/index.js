import { ensureSchema } from "./schema.js";
import { handleMcp } from "./mcp.js";
import { syncAll } from "./sync.js";
import { authUrl, exchangeCode } from "./oura.js";
import { chicagoHour, chicagoMinute, chicagoDate, json, html, safeEqual, notify, sendPush } from "./util.js";
import { runRules, pushText } from "./rules.js";
import { verifyAccess } from "./access.js";
import { handleApi } from "./api.js";
import APP_HTML from "./app.html";
import { runModels } from "./models.js";
import { weekendPush, dinnerPush } from "./pushes.js";
import { capacityStatus } from "./data.js";
import { handleHaeIngest } from "./glucose.js";

const VERSION = "brief-2026-11-12";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    try {
      // Public: liveness only. No health data, no counts.
      if (path === "/") {
        await ensureSchema(env.DB);
        return json({ app: "health", version: VERSION, ok: true, today_chicago: chicagoDate() });
      }

      // Health Auto Export -> glucose. Own bearer token (GLUCOSE_INGEST_TOKEN), separate from MCP_TOKEN.
      if (path === "/ingest/hae") {
        await ensureSchema(env.DB);
        return handleHaeIngest(request, env);
      }

      if (path === "/mcp") {
        const auth = request.headers.get("Authorization") || "";
        const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
        if (!(await safeEqual(token, env.MCP_TOKEN))) {
          return json({ error: "unauthorized" }, 401);
        }
        await ensureSchema(env.DB);
        return handleMcp(request, env);
      }

      // Local-only test hook for the 6:00/6:30 jobs (wrangler dev ignores cron times).
      if (path === "/__dev/morning" && env.DEV_NO_ACCESS === "1" && url.hostname === "localhost") {
        const when = new Date(url.searchParams.get("time") || Date.now());
        return json({ result: await tick(env, when) });
      }

      // Web page + its API. Locked to Cloudflare Access; the worker verifies the
      // Access token itself, so nothing is served if Access is missing or off.
      if (path === "/app" || path.startsWith("/api/")) {
        // DEV_NO_ACCESS exists only in local .dev.vars for wrangler dev; never set it in Cloudflare.
        const devBypass = env.DEV_NO_ACCESS === "1" && url.hostname === "localhost";
        if (!devBypass) {
          const a = await verifyAccess(request, env);
          if (a.error) {
            return path === "/app"
              ? html("<h2>Locked</h2><p>This page needs Cloudflare Access. (" + a.error + ")</p>", 403)
              : json({ error: "forbidden", reason: a.error }, 403);
          }
        }
        await ensureSchema(env.DB);
        if (path === "/app") {
          return new Response(APP_HTML, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer" } });
        }
        return handleApi(request, env, path);
      }

      // Oura re-link. Off unless OURA_AUTH_ENABLED=1, so nobody can attach a
      // different Oura account over the saved tokens.
      if (path === "/auth" || path === "/callback") {
        if (env.OURA_AUTH_ENABLED !== "1") return new Response("Not found", { status: 404 });
        const redirectUri = url.origin + "/callback";
        // CSRF: a one-time nonce in an HttpOnly cookie, also stored in KV for 10 minutes.
        // The callback only proceeds in the browser that started /auth.
        if (path === "/auth") {
          const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
          await env.OURA_KV.put("oauth_state:" + nonce, "1", { expirationTtl: 600 });
          return new Response(null, { status: 302, headers: {
            Location: authUrl(env, redirectUri),
            "Set-Cookie": `oura_auth=${nonce}; Path=/callback; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
          } });
        }
        const cookie = (request.headers.get("Cookie") || "").match(/(?:^|;\s*)oura_auth=([0-9a-f]{32})/);
        const nonce = cookie ? cookie[1] : "";
        if (!nonce || !(await env.OURA_KV.get("oauth_state:" + nonce))) return html("<h2>Sign-in expired or started in another browser. Start again at /auth in this browser.</h2>", 400);
        await env.OURA_KV.delete("oauth_state:" + nonce);
        const code = url.searchParams.get("code");
        if (!code && !url.searchParams.get("error")) return html("<h2>No code returned.</h2>", 400);
        if (url.searchParams.get("error")) return html("<h2>Oura said: " + url.searchParams.get("error").replace(/[<>&]/g, "") + "</h2><p>" + (url.searchParams.get("error_description") || "").replace(/[<>&]/g, "") + "</p>", 400);
        try { await exchangeCode(env, code, redirectUri); }
        catch (e) { return html("<h2>Token exchange failed</h2><p>" + String(e.message || e).replace(/[<>&]/g, "") + "</p>", 502); }
        return html("<h2>Oura connected.</h2><p>Set OURA_AUTH_ENABLED back to 0.</p>");
      }

      return new Response("Not found", { status: 404 });
    } catch (err) {
      console.error(err);
      return json({ error: "server_error" }, 500);
    }
  },

  // One cron, every 15 min from 11:00 to 15:45 UTC. tick() works in Chicago time,
  // so it's right in both CST and CDT.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(tick(env, new Date(event.scheduledTime)));
  },
};

// Push window (brief 1.6): first try 6:00 right after the sync, retry every 15 min
// until last night's Oura sleep is in, last try 9:00 (sends with "sleep data not in yet").
const PUSH_FIRST = 6 * 60, PUSH_LAST = 9 * 60;
const FRIDAY_PUSH = 15 * 60, DINNER_PUSH = 15 * 60 + 30; // 3:00 pm Fri, 3:30 pm weekdays

export async function tick(env, when) {
  const mins = chicagoHour(when) * 60 + chicagoMinute(when);
  const dow = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short" }).format(when);
  const date = chicagoDate(when);
  if (mins >= PUSH_FIRST && mins < PUSH_FIRST + 15) {
    const sync = await morningSync(env, date);
    return { sync, push: await pushAttempt(env, when, false) };
  }
  if (mins >= PUSH_FIRST + 15 && mins <= PUSH_LAST + 5) return pushAttempt(env, when, mins >= PUSH_LAST);
  if (dow === "Fri" && mins >= FRIDAY_PUSH && mins < FRIDAY_PUSH + 15) { await ensureSchema(env.DB); return weekendPush(env, date); }
  if (!["Sat", "Sun"].includes(dow) && mins >= DINNER_PUSH && mins < DINNER_PUSH + 15) { await ensureSchema(env.DB); return dinnerPush(env, date); }
  return null;
}

// 6:00: pull Oura/CPAP/Withings, then run rules (rule 1 may adjust calories).
export async function morningSync(env, date = chicagoDate()) {
  await ensureSchema(env.DB);
  const r = await syncAll(env, { days: 7, trigger: "cron" });
  const bad = [r.oura && !r.oura.ok && "Oura", r.cpap && !r.cpap.ok && "CPAP", r.withings && !r.withings.ok && "Withings"].filter(Boolean);
  if (bad.length) await notify(env, `Health sync problem: ${bad.join(" and ")}. Run sync_now to see details.`);
  // 5.2 model hook: weight trend, expenditure, weekly target (Sunday), and any future model.
  const models = await runModels(env.DB, date);
  await runRules(env.DB, date, { apply: true });
  return { models };
}

// One push attempt. Re-pulls Oura/CPAP, re-runs the rules, and sends only once
// last night's sleep is in (or on the final attempt). Never sends twice a day.
export async function pushAttempt(env, when = new Date(), final = false) {
  await ensureSchema(env.DB);
  const date = chicagoDate(when);
  const st = await env.DB.prepare("SELECT value FROM settings WHERE key='push_enabled'").first();
  if (st && st.value === "0") return { skipped: "push disabled" };
  const done = await env.DB.prepare("SELECT pushed_at FROM plans WHERE date=?").bind(date).first();
  if (done && done.pushed_at) return { skipped: "already pushed" };
  await syncAll(env, { days: 2, trigger: "push-retry" });
  const plan = await runRules(env.DB, date, { apply: true }); // rule 1 is guarded to one change per 14 days
  if (!plan.sleep_ready && !final) return { waiting: "sleep not in yet" };
  const r = await sendPush(env, pushText(plan), "Today");
  if (!r.ok) return { error: r.reason || r.status };
  const dow = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short" }).format(when);
  if (dow === "Sun") {
    const cap = await capacityStatus(env.DB, date);
    const due = cap.due.length ? ` Capacity tests due (90+ days or never): ${cap.due.join(", ")}.` : "";
    await sendPush(env, "Weekly review is ready. Ask Claude for your Sunday review or open the Week tab." + due, "Sunday review");
  }
  await env.DB.prepare("UPDATE plans SET pushed_at=datetime('now') WHERE date=?").bind(date).run();
  return { pushed: true, sleep_ready: plan.sleep_ready };
}
