export const TZ = "America/Chicago";

const ymdFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const hourFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" });

/** YYYY-MM-DD in Chicago for a Date (default now). */
export function chicagoDate(d = new Date()) {
  return ymdFmt.format(d);
}
/** 0-23 hour in Chicago. */
export function chicagoHour(d = new Date()) {
  return Number(hourFmt.format(d));
}
const minFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, minute: "numeric" });
/** 0-59 minute in Chicago. */
export function chicagoMinute(d = new Date()) {
  return Number(minFmt.format(d));
}
/** Add n days to a YYYY-MM-DD string (calendar math, no TZ drift). */
export function addDays(ymd, n) {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
export function isYmd(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}
export function round1(n) {
  return Math.round(n * 10) / 10;
}
export function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
export function html(s, status = 200) {
  return new Response(
    "<!doctype html><meta name=viewport content='width=device-width'>" +
      "<body style='font-family:-apple-system,sans-serif;max-width:560px;margin:40px auto;padding:0 20px;line-height:1.5'>" +
      s + "</body>",
    { status, headers: { "Content-Type": "text/html" } }
  );
}

/** Constant-time string compare (hash both sides so lengths match). */
export async function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

/** Short failure push. Never put health numbers in these. */
// NTFY_TOPIC may be a bare topic name or a full https://ntfy.sh/<topic> URL.
export function ntfyUrl(env) {
  const t = String(env.NTFY_TOPIC || "").trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t.replace(/\/+$/, "");
  return "https://ntfy.sh/" + encodeURIComponent(t.replace(/^\/+|\/+$/g, ""));
}
export async function notifyDetail(env, msg, title = "Health") {
  const u = ntfyUrl(env);
  if (!u) return { ok: false, reason: "NTFY_TOPIC missing" };
  try {
    const headers = { Title: title };
    // With an access token ntfy counts the quota against the account, not the
    // shared Cloudflare egress IP (which hits the anonymous daily limit).
    if (env.NTFY_TOKEN) headers.Authorization = "Bearer " + env.NTFY_TOKEN;
    const r = await fetch(u, { method: "POST", body: msg, headers });
    return { ok: r.ok, status: r.status, reason: r.ok ? null : (await r.text()).slice(0, 200), url_form: /^https?:/i.test(String(env.NTFY_TOPIC).trim()) ? "full url" : "topic name", token: !!env.NTFY_TOKEN };
  } catch (e) { return { ok: false, reason: String(e.message || e) }; }
}
// Pushover is the primary channel (ntfy.sh timed out / hit the shared-IP quota
// from Workers). ntfy stays as a fallback when Pushover isn't configured.
// API: POST https://api.pushover.net/1/messages.json, token + user + message; success = status 1.
export async function pushoverDetail(env, msg, title) {
  try {
    const r = await fetch("https://api.pushover.net/1/messages.json", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: env.PUSHOVER_TOKEN, user: env.PUSHOVER_USER, message: msg, title }),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok && j.status === 1, channel: "pushover", status: r.status, reason: j.errors ? j.errors.join("; ") : null };
  } catch (e) { return { ok: false, channel: "pushover", reason: String(e.message || e) }; }
}
export async function sendPush(env, msg, title = "Health") {
  if (env.PUSHOVER_TOKEN && env.PUSHOVER_USER) return pushoverDetail(env, msg, title);
  return { channel: "ntfy", ...(await notifyDetail(env, msg, title)) };
}
export async function notify(env, msg, title = "Health") {
  return (await sendPush(env, msg, title)).ok;
}
