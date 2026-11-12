// Read/write helpers shared by the MCP tools.
import { addDays, chicagoDate } from "./util.js";

const r1 = (n) => (n == null ? null : Math.round(n * 10) / 10);
const all = async (db, sql, ...b) => (await db.prepare(sql).bind(...b).all()).results || [];
const first = (db, sql, ...b) => db.prepare(sql).bind(...b).first();

// ---------- writes ----------

/** Partial upsert of the days row: only the fields given are changed. */
export async function upsertDay(db, date, fields) {
  const cols = Object.keys(fields).filter((k) => fields[k] !== undefined);
  if (!cols.length) return;
  await db.prepare(
    `INSERT INTO days (date, ${cols.join(",")}, updated_at) VALUES (?, ${cols.map(() => "?").join(",")}, datetime('now'))
     ON CONFLICT(date) DO UPDATE SET ${cols.map((c) => `${c}=excluded.${c}`).join(", ")}, updated_at=datetime('now')`
  ).bind(date, ...cols.map((c) => fields[c])).run();
}

export async function appendNote(db, date, text) {
  const row = await first(db, "SELECT note FROM days WHERE date=?", date);
  const note = row && row.note ? row.note + "\n" + text : text;
  await upsertDay(db, date, { note });
}

// ---------- day ----------

export async function foodTotals(db, date) {
  const t = await first(db,
    "SELECT COUNT(*) items, SUM(cal) cal, SUM(protein_g) protein_g, SUM(sodium_mg) sodium_mg, SUM(sodium_mg IS NULL) sodium_missing FROM food WHERE date=?", date);
  return { items: t.items, cal: r1(t.cal) || 0, protein_g: r1(t.protein_g) || 0, sodium_mg: r1(t.sodium_mg), sodium_missing_items: t.sodium_missing || 0 };
}

export async function getDay(db, date) {
  const prev = addDays(date, -1);
  const [day, food, lifts, bp, oura, cpapPrev, cpapSame] = await Promise.all([
    first(db, "SELECT date, weight, water_oz, wine_glasses, sauna_min, steps, cans, note FROM days WHERE date=?", date),
    all(db, "SELECT id, meal, name, cal, protein_g, sodium_mg, est FROM food WHERE date=? ORDER BY id", date),
    all(db, "SELECT id, exercise, set_no, weight_lb, reps, rpe, note FROM lifts WHERE date=? ORDER BY exercise, set_no", date),
    all(db, "SELECT id, ts, sys, dia, pulse, note FROM bp WHERE date=? ORDER BY ts", date),
    first(db, "SELECT * FROM oura WHERE date=?", date),
    first(db, "SELECT * FROM cpap WHERE date=?", prev),
    first(db, "SELECT * FROM cpap WHERE date=?", date),
  ]);
  return {
    date,
    day: day || null,
    food: { totals: await foodTotals(db, date), items: food.map((f) => ({ ...f, est: !!f.est })) },
    lifts,
    bp,
    oura: oura || null,
    cpap_last_night: cpapPrev || null, // night that started the evening before `date`
    cpap_tonight: cpapSame || null,    // night that started on `date` (only after the next morning's sync)
  };
}

// ---------- ranges ----------

/** One summary row per date in [start, end]. Missing data stays null. */
export async function dailyRows(db, start, end) {
  const prevStart = addDays(start, -1);
  const [days, food, bp, oura, cpap, lifts] = await Promise.all([
    all(db, "SELECT * FROM days WHERE date BETWEEN ? AND ?", start, end),
    all(db, "SELECT date, COUNT(*) n, SUM(cal) cal, SUM(protein_g) p, SUM(sodium_mg) na, SUM(sodium_mg IS NULL) na_missing FROM food WHERE date BETWEEN ? AND ? GROUP BY date", start, end),
    all(db, "SELECT date, AVG(sys) sys, AVG(dia) dia, AVG(pulse) pulse, COUNT(*) n FROM bp WHERE date BETWEEN ? AND ? GROUP BY date", start, end),
    all(db, "SELECT * FROM oura WHERE date BETWEEN ? AND ?", start, end),
    all(db, "SELECT * FROM cpap WHERE date BETWEEN ? AND ?", prevStart, end),
    all(db, "SELECT date, COUNT(*) sets, COUNT(DISTINCT exercise) exercises FROM lifts WHERE date BETWEEN ? AND ? GROUP BY date", start, end),
  ]);
  const by = (arr) => Object.fromEntries(arr.map((r) => [r.date, r]));
  const D = by(days), F = by(food), B = by(bp), O = by(oura), C = by(cpap), L = by(lifts);
  const rows = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const day = D[d] || {}, f = F[d], b = B[d], o = O[d] || {}, c = C[addDays(d, -1)] || {}, l = L[d];
    rows.push({
      date: d,
      weight: day.weight ?? null,
      cal: f ? r1(f.cal) : null,
      protein_g: f ? r1(f.p) : null,
      sodium_mg: f && f.na_missing === 0 ? r1(f.na) : f && f.na != null ? r1(f.na) : null,
      sodium_complete: f ? f.na_missing === 0 : null,
      food_items: f ? f.n : 0,
      wine_glasses: day.wine_glasses ?? null,
      water_oz: day.water_oz ?? null,
      sauna_min: day.sauna_min ?? null,
      bp_sys: b ? Math.round(b.sys) : null,
      bp_dia: b ? Math.round(b.dia) : null,
      bp_readings: b ? b.n : 0,
      sleep_score: o.sleep_score ?? null,
      readiness: o.readiness ?? null,
      hrv: o.hrv ?? null,
      rhr: o.rhr ?? null,
      steps: day.steps ?? o.steps ?? null,
      total_sleep_min: o.total_sleep_min ?? null,
      cpap_hours: c.hours ?? null, // CPAP night that ended the morning of `date`
      ahi: c.ahi ?? null,
      leak: c.leak ?? null,
      mask_off: c.mask_off ?? null,
      lift_sets: l ? l.sets : 0,
    });
  }
  return rows;
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export async function getWeek(db, end) {
  const start = addDays(end, -6);
  const rows = await dailyRows(db, start, end);
  const avgOf = (k) => { const xs = rows.map((r) => r[k]).filter((v) => v != null); return { avg: r1(mean(xs)), n: xs.length }; };
  const loggedFood = rows.filter((r) => r.food_items > 0);
  return {
    start, end,
    summary: {
      calories_total: r1(loggedFood.reduce((a, r) => a + (r.cal || 0), 0)),
      days_with_food_logged: loggedFood.length,
      calories: avgOf("cal"), protein_g: avgOf("protein_g"), sodium_mg: avgOf("sodium_mg"),
      weight: avgOf("weight"), bp_sys: avgOf("bp_sys"), bp_dia: avgOf("bp_dia"),
      hrv: avgOf("hrv"), rhr: avgOf("rhr"), readiness: avgOf("readiness"), sleep_score: avgOf("sleep_score"),
      total_sleep_min: avgOf("total_sleep_min"), steps: avgOf("steps"),
      cpap_hours: avgOf("cpap_hours"), ahi: avgOf("ahi"),
      wine_glasses_total: r1(rows.reduce((a, r) => a + (r.wine_glasses || 0), 0)),
      lift_days: rows.filter((r) => r.lift_sets > 0).length,
    },
    days: rows,
    note: "Averages are over days that have data (n). Calorie/protein averages only count days with food logged.",
  };
}

export const TREND_METRICS = ["weight", "cal", "protein_g", "sodium_mg", "bp_sys", "bp_dia", "hrv", "rhr", "readiness", "sleep_score", "total_sleep_min", "steps", "cpap_hours", "ahi", "leak", "mask_off", "wine_glasses", "water_oz", "sauna_min", "lift_sets"];

export async function getTrends(db, metric, days, end = chicagoDate()) {
  const start = addDays(end, -(days - 1));
  const rows = await dailyRows(db, start, end);
  const series = rows.filter((r) => r[metric] != null && !(metric === "lift_sets" && r[metric] === 0)).map((r) => ({ date: r.date, value: r[metric] }));
  const vals = series.map((s) => s.value);
  const last7 = series.filter((s) => s.date > addDays(end, -7)).map((s) => s.value);
  const prev7 = series.filter((s) => s.date <= addDays(end, -7) && s.date > addDays(end, -14)).map((s) => s.value);
  return {
    metric, start, end, n: series.length,
    mean: r1(mean(vals)),
    min: vals.length ? Math.min(...vals) : null,
    max: vals.length ? Math.max(...vals) : null,
    avg_last_7_days: r1(mean(last7)),
    avg_prior_7_days: r1(mean(prev7)),
    series,
  };
}

export async function getLabs(db, { test, panel } = {}) {
  let sql = "SELECT date, panel, test, value, value_text, unit, flag, note FROM labs WHERE 1=1";
  const b = [];
  if (panel) { sql += " AND panel LIKE ?"; b.push("%" + panel + "%"); }
  if (test) { sql += " AND test LIKE ?"; b.push("%" + test + "%"); }
  sql += " ORDER BY panel, test, date";
  return all(db, sql, ...b);
}

export async function getMeds(db, includeStopped) {
  return all(db, `SELECT name, kind, dose, schedule, status, started, stopped, prescriber, note FROM meds ${includeStopped ? "" : "WHERE status='active'"} ORDER BY kind, name`);
}

export async function getLifts(db, { exercise, days = 90 } = {}) {
  const since = addDays(chicagoDate(), -(days - 1));
  let sql = "SELECT id, date, exercise, set_no, weight_lb, reps, rpe, note FROM lifts WHERE date >= ?";
  const b = [since];
  if (exercise) { sql += " AND exercise LIKE ?"; b.push("%" + exercise + "%"); }
  sql += " ORDER BY exercise, date, set_no";
  const rows = await all(db, sql, ...b);
  const sessions = {};
  for (const r of rows) {
    const k = r.exercise + "|" + r.date;
    (sessions[k] = sessions[k] || { exercise: r.exercise, date: r.date, sets: [] }).sets.push(
      { id: r.id, set_no: r.set_no, weight_lb: r.weight_lb, reps: r.reps, rpe: r.rpe, note: r.note });
  }
  return Object.values(sessions);
}

// ---------- shared inserts (MCP tools and the web page both use these) ----------

export async function logFood(db, date, meal, items) {
  const res = await db.batch(items.map((i) => db.prepare(
    "INSERT INTO food (date, meal, name, cal, protein_g, sodium_mg, est, source) VALUES (?,?,?,?,?,?,?,?) RETURNING id"
  ).bind(date, meal, i.name, i.cal, i.protein_g, i.sodium_mg ?? null, i.est === false ? 0 : 1, i.source || "mcp")));
  return res.map((r, k) => ({ id: r.results[0].id, name: items[k].name }));
}

export async function logLift(db, date, exercise, sets, source = "mcp") {
  const max = await first(db, "SELECT COALESCE(MAX(set_no),0) m FROM lifts WHERE date=? AND exercise=?", date, exercise);
  let n = max.m;
  await db.batch(sets.map((s) => db.prepare(
    "INSERT INTO lifts (date, exercise, set_no, weight_lb, reps, rpe, note, source) VALUES (?,?,?,?,?,?,?,?)"
  ).bind(date, exercise, ++n, s.weight_lb, s.reps, s.rpe ?? null, s.note ?? null, source)));
  return n;
}

export async function logBp(db, when, date, sys, dia, pulse, note, source = "mcp") {
  return first(db, "INSERT INTO bp (ts, date, sys, dia, pulse, note, source) VALUES (?,?,?,?,?,?,?) RETURNING id",
    when.toISOString(), date, sys, dia, pulse ?? null, note ?? null, source);
}

export async function deleteEntry(db, kind, id) {
  const table = { food: "food", lift: "lifts", bp: "bp" }[kind];
  if (!table) return null;
  return db.prepare(`DELETE FROM ${table} WHERE id=? RETURNING *`).bind(id).first();
}

/** Exercises by most recent use, with that last session's sets and the day note. */
export async function exerciseHistory(db, limit = 40) {
  const ex = await all(db, "SELECT exercise, MAX(date) last FROM lifts GROUP BY exercise ORDER BY last DESC LIMIT ?", limit);
  const out = [];
  for (const e of ex) {
    const sets = await all(db, "SELECT set_no, weight_lb, reps, rpe, note FROM lifts WHERE exercise=? AND date=? ORDER BY set_no", e.exercise, e.last);
    const d = await first(db, "SELECT note FROM days WHERE date=?", e.last);
    out.push({ exercise: e.exercise, last_date: e.last, sets, day_note: d ? d.note : null });
  }
  return out;
}

// ---------- phase 2-4 writes ----------

export async function logScan(db, s) {
  await db.prepare(`INSERT INTO scans (date, weight, smm, bfm, pbf, lean_mass, trunk_fat, visceral, raw) VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(date) DO UPDATE SET weight=excluded.weight, smm=excluded.smm, bfm=excluded.bfm, pbf=excluded.pbf, lean_mass=excluded.lean_mass,
      trunk_fat=excluded.trunk_fat, visceral=excluded.visceral, raw=excluded.raw`)
    .bind(s.date, s.weight ?? null, s.smm ?? null, s.bfm ?? null, s.pbf ?? null, s.lean_mass ?? null, s.trunk_fat ?? null, s.visceral ?? null, s.raw ? JSON.stringify(s.raw) : null).run();
  return first(db, "SELECT * FROM scans WHERE date=?", s.date);
}

export async function logEye(db, e) {
  await db.prepare(`INSERT INTO eye (date, injection, drug, interval_weeks, oct_thickness, note) VALUES (?,?,?,?,?,?)
    ON CONFLICT(date) DO UPDATE SET injection=excluded.injection, drug=excluded.drug, interval_weeks=excluded.interval_weeks, oct_thickness=excluded.oct_thickness, note=excluded.note`)
    .bind(e.date, e.injection ? 1 : 0, e.drug ?? null, e.interval_weeks ?? null, e.oct_thickness ?? null, e.note ?? null).run();
  return first(db, "SELECT * FROM eye WHERE date=?", e.date);
}

export async function logGlucose(db, readings, source, toDate) {
  const s = readings.map((r) => db.prepare("INSERT INTO glucose (ts, date, mg_dl, source) VALUES (?,?,?,?) ON CONFLICT(ts) DO UPDATE SET mg_dl=excluded.mg_dl, source=excluded.source")
    .bind(r.ts, toDate(r.ts), r.mg_dl, source || "manual"));
  for (let i = 0; i < s.length; i += 100) await db.batch(s.slice(i, i + 100));
  return readings.length;
}

export async function getGlucose(db, date) {
  const rows = await all(db, "SELECT ts, mg_dl FROM glucose WHERE date=? ORDER BY ts", date);
  const v = rows.map((r) => r.mg_dl);
  return { date, readings: rows.length, mean: v.length ? r1(v.reduce((a, b) => a + b, 0) / v.length) : null, peak: v.length ? Math.max(...v) : null, over_140: v.filter((x) => x > 140).length, series: rows };
}

export const SETTING_KEYS = ["calorie_base", "calorie_floor", "calorie_adjust", "protein_target", "step_baseline", "sodium_cap_default", "sodium_cap_low", "apob_target", "wine_weekly_cap", "push_enabled"];
export async function setSetting(db, key, value) {
  if (!SETTING_KEYS.includes(key)) throw new Error("unknown setting " + key);
  await db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?,?,datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')").bind(key, value == null ? "" : String(value)).run();
}
export async function listSettings(db) {
  return all(db, "SELECT key, value, note, updated_at FROM settings ORDER BY key");
}
export async function setLiftTarget(db, t) {
  await db.prepare(`INSERT INTO lift_targets (exercise, rep_low, rep_high, increment_lb, note, updated_at) VALUES (?,?,?,?,?,datetime('now'))
    ON CONFLICT(exercise) DO UPDATE SET rep_low=excluded.rep_low, rep_high=excluded.rep_high, increment_lb=excluded.increment_lb, note=excluded.note, updated_at=datetime('now')`)
    .bind(t.exercise, t.rep_low, t.rep_high, t.increment_lb ?? 5, t.note ?? null).run();
  return all(db, "SELECT * FROM lift_targets ORDER BY exercise");
}
export async function listLiftTargets(db) {
  return all(db, "SELECT * FROM lift_targets ORDER BY exercise");
}
