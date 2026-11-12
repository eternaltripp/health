import { ensureSchema } from "./schema.js";
import { handleMcp } from "./mcp.js";
import { syncAll } from "./sync.js";
import { authUrl, exchangeCode } from "./oura.js";
import { chicagoHour, chicagoMinute, chicagoDate, json, html, safeEqual, notify } from "./util.js";
import { runRules, pushText } from "./rules.js";
import { verifyAccess } from "./access.js";
import { handleApi } from "./api.js";
import APP_HTML from "./app.html";

const VERSION = "phase4-2026-11-11";

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
        if (url.searchParams.get("step") === "push") { await morningPush(env, when); return json({ pushed: true }); }
        await morningSync(env); return json({ synced: true });
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
        if (path === "/auth") {
          const state = crypto.randomUUID();
          await env.OURA_KV.put("oauth_state:" + state, "1", { expirationTtl: 600 });
          return Response.redirect(authUrl(env, redirectUri, state), 302);
        }
        const state = url.searchParams.get("state") || "";
        if (!(await env.OURA_KV.get("oauth_state:" + state))) return html("<h2>Bad or expired state. Start again at /auth.</h2>", 400);
        await env.OURA_KV.delete("oauth_state:" + state);
        const code = url.searchParams.get("code");
        if (!code) return html("<h2>No code returned.</h2>", 400);
        await exchangeCode(env, code, redirectUri);
        return html("<h2>Oura connected.</h2><p>Set OURA_AUTH_ENABLED back to 0.</p>");
      }

      return new Response("Not found", { status: 404 });
    } catch (err) {
      console.error(err);
      return json({ error: "server_error" }, 500);
    }
  },

  // UTC crons at :00 and :30 of 11 and 12 cover CST and CDT. Only the run that
  // lands on 6:00 / 6:30 Chicago does anything.
  async scheduled(event, env, ctx) {
    const when = new Date(event.scheduledTime);
    const hour = chicagoHour(when), minute = chicagoMinute(when);
    if (hour !== 6) return;
    ctx.waitUntil(minute < 15 ? morningSync(env) : morningPush(env, when));
  },
};

// 6:00: pull Oura/CPAP/Withings, then run rules (rule 1 may adjust calories).
export async function morningSync(env) {
  await ensureSchema(env.DB);
  const r = await syncAll(env, { days: 7, trigger: "cron" });
  const bad = [r.oura && !r.oura.ok && "Oura", r.cpap && !r.cpap.ok && "CPAP", r.withings && !r.withings.ok && "Withings"].filter(Boolean);
  if (bad.length) await notify(env, `Health sync problem: ${bad.join(" and ")}. Run sync_now to see details.`);
  await runRules(env.DB, chicagoDate(), { apply: true });
}

// 6:30: push the plan. Sundays also say the review is ready.
export async function morningPush(env, when = new Date()) {
  await ensureSchema(env.DB);
  const date = chicagoDate(when);
  const st = await env.DB.prepare("SELECT value FROM settings WHERE key='push_enabled'").first();
  if (st && st.value === "0") return;
  let row = await env.DB.prepare("SELECT plan FROM plans WHERE date=?").bind(date).first();
  const plan = row ? JSON.parse(row.plan) : await runRules(env.DB, date, { apply: true });
  await notify(env, pushText(plan), "Today");
  const dow = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short" }).format(when);
  if (dow === "Sun") await notify(env, "Weekly review is ready. Ask Claude for your Sunday review or open the Week tab.", "Sunday review");
  await env.DB.prepare("UPDATE plans SET pushed_at=datetime('now') WHERE date=?").bind(date).run();
}
