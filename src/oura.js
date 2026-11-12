// Oura v2 API. OAuth refresh flow carried over from the old connector
// (little-queen-2e28) so the tokens already in OURA_KV keep working.
import { addDays, round1 } from "./util.js";

const OURA_AUTH = "https://cloud.ouraring.com/oauth/authorize";
const OURA_TOKEN = "https://api.ouraring.com/oauth/token";
const OURA_API = "https://api.ouraring.com/v2/usercollection";
// heart_health = VO2 max + cardiovascular age (RESEARCHED: openwearables.io Oura guide, Home Assistant forum). Must be ticked on the Oura app, and the app's redirect URI must include https://health.m2thompson.workers.dev/callback.
const SCOPES = "personal daily heartrate heart_health";

export function authUrl(env, redirectUri, state) {
  const p = new URLSearchParams({
    response_type: "code", client_id: env.CLIENT_ID, redirect_uri: redirectUri, scope: SCOPES, state,
  });
  return OURA_AUTH + "?" + p.toString();
}

export async function exchangeCode(env, code, redirectUri) {
  const r = await fetch(OURA_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code", code, redirect_uri: redirectUri,
      client_id: env.CLIENT_ID, client_secret: env.CLIENT_SECRET,
    }),
  });
  if (!r.ok) throw new Error("oura_token_exchange_failed " + r.status);
  await saveTokens(env, await r.json());
}

async function saveTokens(env, t) {
  await env.OURA_KV.put("tokens", JSON.stringify({
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expires_at: Date.now() + Number(t.expires_in || 86400) * 1000,
  }));
}

async function getAccessToken(env) {
  const raw = await env.OURA_KV.get("tokens");
  if (!raw) throw new Error("oura_not_connected");
  const t = JSON.parse(raw);
  if (Date.now() < t.expires_at - 60000) return t.access_token;
  const r = await fetch(OURA_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token", refresh_token: t.refresh_token,
      client_id: env.CLIENT_ID, client_secret: env.CLIENT_SECRET,
    }),
  });
  if (!r.ok) throw new Error("oura_refresh_failed " + r.status);
  const j = await r.json();
  await saveTokens(env, {
    access_token: j.access_token,
    refresh_token: j.refresh_token || t.refresh_token, // Oura rotates refresh tokens
    expires_in: j.expires_in,
  });
  return j.access_token;
}

async function getAll(url, headers, errors, name) {
  const out = [];
  let next = null;
  for (let page = 0; page < 20; page++) {
    const u = next ? url + "&next_token=" + encodeURIComponent(next) : url;
    const r = await fetch(u, { headers });
    if (!r.ok) { errors.push(`${name}: HTTP ${r.status}`); break; }
    const j = await r.json();
    out.push(...(j.data || []));
    next = j.next_token;
    if (!next) break;
  }
  return out;
}

/** Returns { rows: [{date, ...oura columns}], errors: [] } for start..end inclusive. */
export async function pullOura(env, start, end) {
  const access = await getAccessToken(env);
  const h = { Authorization: "Bearer " + access };
  // end_date is exclusive on these endpoints: ask through the day after `end`.
  const q = `?start_date=${start}&end_date=${addDays(end, 1)}`;
  const errors = [];
  const [readiness, dailySleep, sleep, activity] = await Promise.all([
    getAll(`${OURA_API}/daily_readiness${q}`, h, errors, "daily_readiness"),
    getAll(`${OURA_API}/daily_sleep${q}`, h, errors, "daily_sleep"),
    getAll(`${OURA_API}/sleep${q}`, h, errors, "sleep"),
    getAll(`${OURA_API}/daily_activity${q}`, h, errors, "daily_activity"),
  ]);
  // 1.7 VO2 max and cardiovascular age. Soft errors: if the token lacks the scope or the
  // ring hasn't produced a value, the rest of the sync still counts as OK.
  const soft = [];
  const [vo2, cva] = await Promise.all([
    getAll(`${OURA_API}/vO2_max${q}`, h, soft, "vO2_max"),
    getAll(`${OURA_API}/daily_cardiovascular_age${q}`, h, soft, "daily_cardiovascular_age"),
  ]);

  const byDay = {};
  const put = (arr, fn) => arr.forEach((rec) => {
    const d = rec.day || (rec.timestamp || "").slice(0, 10);
    if (!d || d < start || d > end) return;
    byDay[d] = byDay[d] || { date: d };
    fn(byDay[d], rec);
  });
  put(readiness, (o, r) => {
    o.readiness = r.score ?? null;
    o.temp_dev = r.temperature_deviation != null ? round1(r.temperature_deviation) : null;
  });
  put(dailySleep, (o, r) => { o.sleep_score = r.score ?? null; });
  // Several sleep records per day are possible (naps). Keep the longest.
  put(sleep, (o, r) => {
    const dur = Number(r.total_sleep_duration || 0);
    if (o._main != null && dur <= o._main) return;
    o._main = dur;
    o.hrv = r.average_hrv != null ? Math.round(r.average_hrv) : null;
    o.rhr = r.lowest_heart_rate ?? null;
    o.resp_rate = r.average_breath != null ? round1(r.average_breath) : null;
    o.total_sleep_min = r.total_sleep_duration != null ? Math.round(r.total_sleep_duration / 60) : null;
    o.awake_min = r.awake_time != null ? Math.round(r.awake_time / 60) : null;
    o.efficiency = r.efficiency ?? null;
  });
  put(activity, (o, r) => {
    o.steps = r.steps ?? null;
    o.active_cal = r.active_calories ?? null;
  });
  put(vo2, (o, r) => { if (r.vo2_max != null) o.vo2_max = r.vo2_max; });
  put(cva, (o, r) => { if (r.vascular_age != null) o.cardio_age = r.vascular_age; });
  const rows = Object.keys(byDay).sort().map((k) => { const o = byDay[k]; delete o._main; return o; });
  return { rows, errors, soft_errors: soft, vo2_records: vo2.length, cardio_age_records: cva.length };
}
