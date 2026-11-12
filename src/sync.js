import { pullOura } from "./oura.js";
import { pullCpap } from "./myair.js";
import { chicagoDate, addDays } from "./util.js";
import { withingsConfigured, pullWithings, saveWithings } from "./withings.js";

const OURA_COLS = ["sleep_score", "readiness", "hrv", "rhr", "steps", "total_sleep_min", "efficiency", "awake_min", "resp_rate", "temp_dev", "active_cal"];
const CPAP_COLS = ["hours", "ahi", "leak", "mask_off", "myair_score"];

// Upsert keyed on date. A re-run overwrites the row; a null from the API never
// wipes a value we already have (Oura fills a day in over the morning).
function upsertSql(table, cols) {
  const all = ["date", ...cols];
  return `INSERT INTO ${table} (${all.join(",")}, updated_at) VALUES (${all.map(() => "?").join(",")}, datetime('now'))
    ON CONFLICT(date) DO UPDATE SET ${cols.map((c) => `${c}=COALESCE(excluded.${c}, ${table}.${c})`).join(", ")}, updated_at=datetime('now')`;
}

async function upsert(db, table, cols, rows) {
  if (!rows.length) return 0;
  const sql = upsertSql(table, cols);
  await db.batch(rows.map((r) => db.prepare(sql).bind(r.date, ...cols.map((c) => (r[c] === undefined ? null : r[c])))));
  return rows.length;
}

async function log(db, trigger, source, ok, rows, detail) {
  await db.prepare("INSERT INTO sync_log (trigger, source, ok, rows, detail) VALUES (?,?,?,?,?)")
    .bind(trigger, source, ok ? 1 : 0, rows, detail ? String(detail).slice(0, 500) : null).run();
}

/** Pull the last `days` days (through today, Chicago) from Oura and myAir into D1. */
export async function syncAll(env, { days = 7, trigger = "sync_now", start: startArg } = {}) {
  const end = chicagoDate();
  const start = startArg || addDays(end, -(days - 1));
  const out = { window: { start, end }, oura: null, cpap: null };

  try {
    const { rows, errors } = await pullOura(env, start, end);
    const n = await upsert(env.DB, "oura", OURA_COLS, rows);
    out.oura = { ok: errors.length === 0, rows: n, dates: rows.map((r) => r.date), errors };
    await log(env.DB, trigger, "oura", errors.length === 0, n, errors.join("; "));
  } catch (e) {
    out.oura = { ok: false, rows: 0, error: String(e.message || e) };
    await log(env.DB, trigger, "oura", false, 0, out.oura.error);
  }

  try {
    // CPAP nights are dated by when they start, so include the night before `start`.
    const rows = await pullCpap(env, addDays(start, -1), end);
    const n = await upsert(env.DB, "cpap", CPAP_COLS, rows);
    out.cpap = { ok: true, rows: n, dates: rows.map((r) => r.date) };
    await log(env.DB, trigger, "cpap", true, n, null);
  } catch (e) {
    out.cpap = { ok: false, rows: 0, error: String(e.message || e) };
    await log(env.DB, trigger, "cpap", false, 0, out.cpap.error);
  }
  if (withingsConfigured(env) && (await env.OURA_KV.get("withings"))) {
    try {
      const startEpoch = Math.floor(new Date(start + "T00:00:00-06:00").getTime() / 1000) - 86400;
      const n = await saveWithings(env.DB, await pullWithings(env, startEpoch));
      out.withings = { ok: true, ...n };
      await log(env.DB, trigger, "withings", true, n.weights + n.bp, null);
    } catch (e) {
      out.withings = { ok: false, error: String(e.message || e) };
      await log(env.DB, trigger, "withings", false, 0, out.withings.error);
    }
  } else {
    out.withings = { ok: true, skipped: withingsConfigured(env) ? "not connected yet" : "not configured" };
  }
  return out;
}
