// Withings (scale + BP cuff). Off until WITHINGS_CLIENT_ID / WITHINGS_CLIENT_SECRET exist.
// API per developer.withings.com/llms.md: authorize2, POST /v2/oauth2 action=requesttoken,
// POST /measure action=getmeas; value = value * 10^unit; tokens under body.*
import { chicagoDate } from "./util.js";

const AUTH = "https://account.withings.com/oauth2_user/authorize2";
const TOKEN = "https://wbsapi.withings.net/v2/oauth2";
const MEASURE = "https://wbsapi.withings.net/measure";
const KG_LB = 2.20462;

export const withingsConfigured = (env) => !!(env.WITHINGS_CLIENT_ID && env.WITHINGS_CLIENT_SECRET);

export async function withingsStatus(env) {
  if (!withingsConfigured(env)) return { configured: false, connected: false };
  return { configured: true, connected: !!(await env.OURA_KV.get("withings")) };
}

export async function withingsAuthUrl(env, redirectUri) {
  const state = crypto.randomUUID();
  await env.OURA_KV.put("withings_state:" + state, "1", { expirationTtl: 600 });
  return AUTH + "?" + new URLSearchParams({ response_type: "code", client_id: env.WITHINGS_CLIENT_ID, scope: "user.metrics", redirect_uri: redirectUri, state });
}

async function tokenCall(env, params) {
  const r = await fetch(TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ action: "requesttoken", client_id: env.WITHINGS_CLIENT_ID, client_secret: env.WITHINGS_CLIENT_SECRET, ...params }) });
  const j = await r.json();
  if (j.status !== 0 || !j.body || !j.body.access_token) throw new Error("withings_token_failed status " + j.status);
  const t = { access: j.body.access_token, refresh: j.body.refresh_token, exp: Date.now() + Number(j.body.expires_in || 10800) * 1000 };
  await env.OURA_KV.put("withings", JSON.stringify(t)); // Withings rotates refresh tokens: always save the new one
  return t;
}

export async function withingsCallback(env, url, redirectUri) {
  const state = url.searchParams.get("state") || "";
  if (!(await env.OURA_KV.get("withings_state:" + state))) throw new Error("bad_state");
  await env.OURA_KV.delete("withings_state:" + state);
  await tokenCall(env, { grant_type: "authorization_code", code: url.searchParams.get("code") || "", redirect_uri: redirectUri });
}

async function access(env) {
  const raw = await env.OURA_KV.get("withings");
  if (!raw) throw new Error("withings_not_connected");
  const t = JSON.parse(raw);
  if (Date.now() < t.exp - 120000) return t.access;
  return (await tokenCall(env, { grant_type: "refresh_token", refresh_token: t.refresh })).access;
}

/** Pull measures since `startEpoch` into days.weight, bp and body_comp. Idempotent. */
export async function pullWithings(env, startEpoch) {
  const tok = await access(env);
  const r = await fetch(MEASURE, {
    method: "POST",
    headers: { Authorization: "Bearer " + tok, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ action: "getmeas", meastypes: "1,5,6,8,76,9,10,11", category: "1", startdate: String(startEpoch), enddate: String(Math.floor(Date.now() / 1000)) }),
  });
  const j = await r.json();
  if (j.status !== 0) throw new Error("withings_getmeas_status " + j.status);
  return mapGroups(j.body.measuregrps || []);
}

export function mapGroups(groups) {
  const weights = {}, bps = [], comp = {};
  for (const g of groups) {
    const when = new Date(g.date * 1000), date = chicagoDate(when);
    const v = {};
    for (const m of g.measures || []) v[m.type] = m.value * Math.pow(10, m.unit);
    if (v[1] != null) {
      // keep the first weigh-in of the day (morning)
      if (!weights[date] || g.date < weights[date].t) weights[date] = { t: g.date, lb: Math.round(v[1] * KG_LB * 10) / 10 };
      const hasComp = v[6] != null || v[5] != null || v[76] != null;
      if (hasComp && (!comp[date] || g.date < comp[date].t)) {
        comp[date] = { t: g.date, weight_lb: v[1] * KG_LB, fat_pct: v[6] ?? null, fat_mass_lb: v[8] != null ? v[8] * KG_LB : null, lean_mass_lb: v[5] != null ? v[5] * KG_LB : null, muscle_mass_lb: v[76] != null ? v[76] * KG_LB : null };
      }
    }
    if (v[10] != null && v[9] != null) bps.push({ ts: when.toISOString(), date, sys: Math.round(v[10]), dia: Math.round(v[9]), pulse: v[11] != null ? Math.round(v[11]) : null, key: "withings:" + g.grpid });
  }
  return { weights, bps, comp };
}

export async function saveWithings(db, m) {
  const s = [];
  for (const [date, w] of Object.entries(m.weights)) {
    s.push(db.prepare("INSERT INTO days (date, weight, updated_at) VALUES (?,?,datetime('now')) ON CONFLICT(date) DO UPDATE SET weight=excluded.weight, updated_at=datetime('now')").bind(date, w.lb));
  }
  for (const b of m.bps) {
    s.push(db.prepare("INSERT INTO bp (ts, date, sys, dia, pulse, source, src_key) VALUES (?,?,?,?,?,'withings',?) ON CONFLICT(src_key) DO UPDATE SET sys=excluded.sys, dia=excluded.dia, pulse=excluded.pulse").bind(b.ts, b.date, b.sys, b.dia, b.pulse, b.key));
  }
  const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
  for (const [date, c] of Object.entries(m.comp)) {
    s.push(db.prepare(`INSERT INTO body_comp (date, source, weight_lb, fat_pct, fat_mass_lb, lean_mass_lb, muscle_mass_lb) VALUES (?, 'withings', ?,?,?,?,?)
      ON CONFLICT(date, source) DO UPDATE SET weight_lb=excluded.weight_lb, fat_pct=excluded.fat_pct, fat_mass_lb=excluded.fat_mass_lb, lean_mass_lb=excluded.lean_mass_lb, muscle_mass_lb=excluded.muscle_mass_lb, updated_at=datetime('now')`)
      .bind(date, r1(c.weight_lb), r1(c.fat_pct), r1(c.fat_mass_lb), r1(c.lean_mass_lb), r1(c.muscle_mass_lb)));
  }
  if (s.length) await db.batch(s);
  return { weights: Object.keys(m.weights).length, bp: m.bps.length, body_comp: Object.keys(m.comp).length };
}
