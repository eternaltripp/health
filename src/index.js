import { ensureSchema } from "./schema.js";
import { handleMcp } from "./mcp.js";
import { syncAll } from "./sync.js";
import { authUrl, exchangeCode } from "./oura.js";
import { chicagoHour, chicagoDate, json, html, safeEqual, notify } from "./util.js";

const VERSION = "phase1-2026-11-11";

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

  // Two UTC crons cover CST and CDT; run only the one that lands on 6 a.m. Chicago.
  async scheduled(event, env, ctx) {
    const hour = chicagoHour(new Date(event.scheduledTime));
    if (hour !== 6) return;
    ctx.waitUntil((async () => {
      await ensureSchema(env.DB);
      const r = await syncAll(env, { days: 7, trigger: "cron" });
      const bad = [r.oura && !r.oura.ok && "Oura", r.cpap && !r.cpap.ok && "CPAP"].filter(Boolean);
      if (bad.length) await notify(env, `Health sync problem: ${bad.join(" and ")}. Run sync_now to see details.`);
    })());
  },
};
