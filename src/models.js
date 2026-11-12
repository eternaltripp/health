// Phase 2 models (brief 2026-11-12, sections 2 and 5).
// Every model writes model_outputs rows: (date, model, value, inputs JSON, version).
// runModels() is the cron hook: add a model to MODELS and the 6:00 run picks it up.
import { addDays } from "./util.js";

const all = async (db, sql, ...b) => (await db.prepare(sql).bind(...b).all()).results || [];
const first = (db, sql, ...b) => db.prepare(sql).bind(...b).first();
const r1 = (n) => (n == null ? null : Math.round(n * 10) / 10);

export const M = {
  // Weight trend: local-level Kalman filter.
  // r = scale noise variance, 1.5 lb SD day to day (FROM MEMORY: typical water/gut swing).
  // q = trend drift variance per day, chosen so the steady-state gain is 0.1, the same
  // smoothing as the EWMA alpha 0.1 in the brief (SPEC). Steady gain K solves q/r = K^2/(1-K).
  kalmanR: 2.25, kalmanQ: 0.025,
  // Expenditure (SPEC, brief 2.2)
  expWindow: 21, expMinDays: 14, expCoverage: 0.8, kcalPerLb: 3500,
  // Weekly target (SPEC, brief 2.3)
  deficit: 500, floor: 1700, weeklyCap: 150,
};

async function save(db, date, model, value, inputs, version) {
  await db.prepare(`INSERT INTO model_outputs (date, model, value, inputs, version) VALUES (?,?,?,?,?)
    ON CONFLICT(date, model) DO UPDATE SET value=excluded.value, inputs=excluded.inputs, version=excluded.version, created_at=datetime('now')`)
    .bind(date, model, value, JSON.stringify(inputs), version).run();
}

// ---------------- 2.1 weight trend ----------------
/** Runs the filter from the first weigh-in through `end`. Returns [{date, weight, trend, sd}]. */
export async function weightTrendSeries(db, end) {
  const rows = await all(db, "SELECT date, weight FROM days WHERE weight IS NOT NULL AND date<=? ORDER BY date", end);
  if (!rows.length) return [];
  const W = Object.fromEntries(rows.map((r) => [r.date, r.weight]));
  let x = rows[0].weight, P = M.kalmanR;
  const out = [];
  for (let d = rows[0].date; d <= end; d = addDays(d, 1)) {
    if (d !== rows[0].date) P += M.kalmanQ; // predict: trend carries forward, uncertainty grows
    const z = W[d];
    let K = null;
    if (z != null) { K = P / (P + M.kalmanR); x = x + K * (z - x); P = (1 - K) * P; }
    out.push({ date: d, weight: z ?? null, trend: Math.round(x * 100) / 100, sd: Math.round(Math.sqrt(P) * 100) / 100, gain: K == null ? null : Math.round(K * 1000) / 1000 });
  }
  return out;
}

async function modelWeightTrend(db, date) {
  const s = await weightTrendSeries(db, date);
  if (!s.length) return { model: "weight_trend", skipped: "no weigh-ins" };
  // Store every day (cheap, and keeps history consistent if old weights are corrected).
  const stmts = s.map((p) => db.prepare(`INSERT INTO model_outputs (date, model, value, inputs, version) VALUES (?,?,?,?,?)
    ON CONFLICT(date, model) DO UPDATE SET value=excluded.value, inputs=excluded.inputs, version=excluded.version, created_at=datetime('now')`)
    .bind(p.date, "weight_trend", p.trend, JSON.stringify({ weight: p.weight, sd_lb: p.sd, gain: p.gain, r: M.kalmanR, q: M.kalmanQ }), "kalman-1"));
  for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100));
  const last = s[s.length - 1];
  return { model: "weight_trend", date, value: last.trend, sd_lb: last.sd, days: s.length };
}

// ---------------- 2.2 expenditure ----------------
/** Estimated daily burn from intake and trend change. Window ends yesterday (today isn't complete). */
export async function computeExpenditure(db, date) {
  const end = addDays(date, -1);
  const firstBoth = await first(db, `SELECT MIN(d.date) d FROM days d WHERE d.weight IS NOT NULL AND EXISTS (SELECT 1 FROM food f WHERE f.date=d.date)`);
  const earliest = firstBoth && firstBoth.d;
  const base = { model: "expenditure", date };
  if (!earliest || earliest > end) return { ...base, ok: false, reason: "no days with both food and weight" };
  let start = addDays(end, -(M.expWindow - 1));
  if (start < earliest) start = earliest;
  const nDays = Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
  if (nDays < M.expMinDays) return { ...base, ok: false, reason: `only ${nDays} days of history (need ${M.expMinDays})`, window: { start, end } };
  const food = await all(db, "SELECT date, SUM(cal) cal FROM food WHERE date BETWEEN ? AND ? GROUP BY date", start, end);
  const wts = await all(db, "SELECT date FROM days WHERE weight IS NOT NULL AND date BETWEEN ? AND ?", start, end);
  const W = new Set(wts.map((w) => w.date));
  const both = food.filter((f) => W.has(f.date)).length;
  const coverage = both / nDays;
  const s = await weightTrendSeries(db, end);
  const T = Object.fromEntries(s.map((p) => [p.date, p.trend]));
  // Change from the day before the window (if the trend exists then) to the window's last day.
  const t0date = T[addDays(start, -1)] != null ? addDays(start, -1) : start;
  const span = Math.round((Date.parse(end) - Date.parse(t0date)) / 86400000);
  const intake = food.reduce((a, f) => a + (f.cal || 0), 0) / (food.length || 1);
  const change = T[end] - T[t0date];
  const inputs = { window: { start, end }, n_days: nDays, days_food_and_weight: both, coverage: r1(coverage * 100), intake_avg: Math.round(intake),
    trend_start: T[t0date], trend_end: T[end], trend_change: r1(change), span_days: span, kcal_per_lb: M.kcalPerLb, kcal_per_lb_label: "SPEC" };
  if (coverage < M.expCoverage) return { ...base, ok: false, reason: `not enough logging: ${r1(coverage * 100)}% of days have food and weight (need 80%)`, inputs };
  const burn = Math.round(intake - (change * M.kcalPerLb) / span);
  return { ...base, ok: true, value: burn, inputs };
}

async function modelExpenditure(db, date) {
  const r = await computeExpenditure(db, date);
  if (r.ok) { await save(db, date, "expenditure", r.value, r.inputs, "exp-1"); return r; }
  // Keep the last estimate, flagged.
  const prev = await first(db, "SELECT date, value FROM model_outputs WHERE model='expenditure' AND date<? AND value IS NOT NULL ORDER BY date DESC LIMIT 1", date);
  await save(db, date, "expenditure", prev ? prev.value : null, { ...(r.inputs || {}), flag: r.reason, carried_from: prev ? prev.date : null }, "exp-1");
  return { ...r, value: prev ? prev.value : null, carried_from: prev ? prev.date : null };
}

// ---------------- 2.3 weekly target ----------------
const isSunday = (d) => new Date(d + "T12:00:00Z").getUTCDay() === 0;
export const weekStart = (d) => { const dow = new Date(d + "T12:00:00Z").getUTCDay(); return addDays(d, -((dow + 6) % 7)); }; // Monday

async function modelTarget(db, date, { force = false } = {}) {
  const today = await first(db, "SELECT date, value FROM model_outputs WHERE model='calorie_target' AND date=?", date);
  const prev = await first(db, "SELECT date, value FROM model_outputs WHERE model='calorie_target' AND date<? ORDER BY date DESC LIMIT 1", date);
  // Set once a week on Sunday's run. Before any target exists, set one on the first run.
  if (!force && today) return { model: "calorie_target", kept: today };
  if (!force && prev && !isSunday(date)) return { model: "calorie_target", kept: prev };
  const exp = await first(db, "SELECT value, inputs FROM model_outputs WHERE model='expenditure' AND date<=? AND value IS NOT NULL ORDER BY date DESC LIMIT 1", date);
  const seed = await first(db, "SELECT value FROM settings WHERE key='calorie_base'");
  const from = prev ? prev.value : Number(seed ? seed.value : 1900);
  if (!exp) {
    await save(db, date, "calorie_target", Math.max(M.floor, from), { reason: "no expenditure estimate yet, using seed", seed: from }, "target-1");
    return { model: "calorie_target", value: Math.max(M.floor, from), seeded: true };
  }
  const raw = exp.value - M.deficit;
  let t = Math.max(from - M.weeklyCap, Math.min(from + M.weeklyCap, raw));
  t = Math.max(M.floor, Math.round(t / 10) * 10);
  const inputs = { burn: exp.value, deficit: M.deficit, raw_target: raw, previous: from, previous_from: prev ? prev.date : "calorie_base seed", cap: M.weeklyCap, floor: M.floor,
    capped: t !== Math.max(M.floor, Math.round(raw / 10) * 10), labels: "deficit 500, floor 1700, cap 150: SPEC (brief 2.3)" };
  await save(db, date, "calorie_target", t, inputs, "target-1");
  return { model: "calorie_target", value: t, inputs };
}

/** The current model outputs for a date, for the plan / Week tab. */
export async function modelSummary(db, date) {
  const get = (m) => first(db, "SELECT date, value, inputs FROM model_outputs WHERE model=? AND date<=? ORDER BY date DESC LIMIT 1", m, date);
  const [wt, ex, tg] = await Promise.all([get("weight_trend"), get("expenditure"), get("calorie_target")]);
  const p = (r) => (r ? { date: r.date, value: r.value, inputs: JSON.parse(r.inputs || "null") } : null);
  return { trend_weight: p(wt), expenditure: p(ex), weekly_target: p(tg) };
}

// ---------------- 5.2 cron hook ----------------
// Each entry: { name, run(db, date) }. Errors in one model never stop the others.
export const MODELS = [
  { name: "weight_trend", run: modelWeightTrend },
  { name: "expenditure", run: modelExpenditure },
  { name: "calorie_target", run: modelTarget },
];

export async function runModels(db, date, opts = {}) {
  const out = [];
  for (const m of MODELS) {
    try { out.push(await m.run(db, date, opts)); } catch (e) { out.push({ model: m.name, error: String(e.message || e) }); }
  }
  return out;
}
