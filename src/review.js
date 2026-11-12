// Sunday review, visit packet, body summary.
import { addDays, chicagoDate } from "./util.js";
import { getSettings, alcoholReport, evaluate } from "./rules.js";

const all = async (db, sql, ...b) => (await db.prepare(sql).bind(...b).all()).results || [];
const first = (db, sql, ...b) => db.prepare(sql).bind(...b).first();
const r1 = (n) => (n == null ? null : Math.round(n * 10) / 10);
const avg = async (db, sql, ...b) => (await first(db, sql, ...b)) || {};

export async function getReview(db, end = chicagoDate()) {
  const start = addDays(end, -6), pStart = addDays(end, -13), pEnd = addDays(end, -7);
  const st = await getSettings(db);
  const [wNow, wPrev, bpNow, bpPrev, protDays, calWeek, scan, lifts, plan, alcohol] = await Promise.all([
    avg(db, "SELECT AVG(weight) v, COUNT(weight) n FROM days WHERE date BETWEEN ? AND ?", start, end),
    avg(db, "SELECT AVG(weight) v, COUNT(weight) n FROM days WHERE date BETWEEN ? AND ?", pStart, pEnd),
    avg(db, "SELECT AVG(sys) s, AVG(dia) d, COUNT(*) n FROM bp WHERE date BETWEEN ? AND ?", start, end),
    avg(db, "SELECT AVG(sys) s, AVG(dia) d, COUNT(*) n FROM bp WHERE date BETWEEN ? AND ?", pStart, pEnd),
    all(db, "SELECT date, SUM(protein_g) p, SUM(cal) c FROM food WHERE date BETWEEN ? AND ? GROUP BY date", start, end),
    avg(db, "SELECT SUM(cal) c FROM food WHERE date BETWEEN ? AND ?", start, end),
    all(db, "SELECT * FROM scans ORDER BY date DESC LIMIT 2"),
    liftProgress(db, start, end),
    evaluate(db, end),
    alcoholReport(db, end, 60),
  ]);
  return {
    week: { start, end },
    weight: { avg_7d: r1(wNow.v), weigh_ins: wNow.n, prior_avg_7d: r1(wPrev.v), change_lb: wNow.v && wPrev.v ? r1(wNow.v - wPrev.v) : null },
    lean_mass: scan.length ? { latest: scan[0], previous: scan[1] || null } : "No InBody scan logged yet",
    lifts,
    bp: { avg_7d: bpNow.n ? `${Math.round(bpNow.s)}/${Math.round(bpNow.d)}` : null, readings: bpNow.n, prior: bpPrev.n ? `${Math.round(bpPrev.s)}/${Math.round(bpPrev.d)}` : null },
    protein: { target: st.protein_target, days_hit: protDays.filter((d) => d.p >= st.protein_target).length, days_logged: protDays.length },
    calories: { week_total: Math.round(calWeek.c || 0), weekly_budget: (st.calorie_base + st.calorie_adjust) * 7 },
    next_week: { calorie_target: plan.calorie_target, sodium_cap: plan.sodium_cap, protein_target: plan.protein_target, training_call_today: plan.training_call },
    watch_items: plan.watch_items,
    alcohol,
    scoreboard: await scoreboard(db, end),
  };
}

async function liftProgress(db, start, end) {
  const ex = await all(db, "SELECT DISTINCT exercise FROM lifts WHERE date BETWEEN ? AND ?", start, end);
  const out = [];
  for (const { exercise } of ex) {
    const best = async (s, e) => first(db, "SELECT date, weight_lb, reps FROM lifts WHERE exercise=? AND date BETWEEN ? AND ? ORDER BY weight_lb DESC, reps DESC LIMIT 1", exercise, s, e);
    const now = await best(start, end), before = await best("0000-00-00", addDays(start, -1));
    out.push({ exercise, best_this_week: now ? `${now.weight_lb} x ${now.reps}` : null, best_before: before ? `${before.weight_lb} x ${before.reps} (${before.date})` : null });
  }
  return out;
}

export async function scoreboard(db, end = chicagoDate()) {
  const lab = (t) => first(db, "SELECT date, value, value_text, flag FROM labs WHERE test=? ORDER BY date DESC LIMIT 1", t);
  const [w, bp, hct, apob, hdl, scan, eye] = await Promise.all([
    first(db, "SELECT AVG(weight) v FROM days WHERE date BETWEEN ? AND ?", addDays(end, -6), end),
    first(db, "SELECT AVG(sys) s, AVG(dia) d, COUNT(*) n FROM bp WHERE date BETWEEN ? AND ?", addDays(end, -6), end),
    lab("Hematocrit"), lab("ApoB"), lab("HDL"),
    first(db, "SELECT date, lean_mass FROM scans WHERE lean_mass IS NOT NULL ORDER BY date DESC LIMIT 1"),
    all(db, "SELECT date FROM eye WHERE injection=1 ORDER BY date DESC LIMIT 2"),
  ]);
  const weeksBetween = eye.length === 2 ? r1((new Date(eye[0].date) - new Date(eye[1].date)) / (7 * 864e5)) : null;
  return {
    weight_7d_avg: r1(w && w.v), lean_mass: scan || null,
    bp_7d_avg: bp && bp.n ? `${Math.round(bp.s)}/${Math.round(bp.d)}` : null,
    hematocrit: hct, apob: apob || "not tested yet", hdl,
    vo2_max: "no baseline yet", eye_weeks_between_injections: weeksBetween,
  };
}

export async function visitPacket(db, end = chicagoDate(), days = 30) {
  const s = addDays(end, -(days - 1));
  const [bp, cpap, hct, weight, meds, eye, rhr] = await Promise.all([
    first(db, "SELECT AVG(sys) s, AVG(dia) d, COUNT(*) n, MIN(date) first, MAX(date) last FROM bp WHERE date BETWEEN ? AND ?", s, end),
    first(db, "SELECT COUNT(*) n, SUM(hours>=4) ok, AVG(hours) h, AVG(ahi) ahi FROM cpap WHERE date BETWEEN ? AND ?", s, end),
    all(db, "SELECT date, value, flag FROM labs WHERE test='Hematocrit' ORDER BY date DESC LIMIT 3"),
    all(db, "SELECT date, weight FROM days WHERE weight IS NOT NULL AND date BETWEEN ? AND ? ORDER BY date", s, end),
    all(db, "SELECT name, dose, schedule FROM meds WHERE status='active' ORDER BY kind, name"),
    all(db, "SELECT * FROM eye ORDER BY date DESC LIMIT 6"),
    first(db, "SELECT AVG(rhr) r, AVG(hrv) h FROM oura WHERE date BETWEEN ? AND ?", s, end),
  ]);
  return {
    window: { start: s, end },
    blood_pressure: bp.n ? { avg: `${Math.round(bp.s)}/${Math.round(bp.d)}`, readings: bp.n } : "No home BP readings in this window",
    hematocrit_recent: hct,
    cpap: cpap.n ? { nights: cpap.n, nights_4h_plus: cpap.ok, avg_hours: r1(cpap.h), avg_ahi: r1(cpap.ahi) } : null,
    weight: weight.length ? { first: weight[0], last: weight[weight.length - 1] } : null,
    oura_avg: { rhr: r1(rhr.r), hrv: r1(rhr.h) },
    active_meds: meds,
    eye_history: eye,
  };
}

export async function bodySummary(db) {
  const [scans, eye, labs, bc] = await Promise.all([
    all(db, "SELECT * FROM scans ORDER BY date DESC LIMIT 5"),
    all(db, "SELECT * FROM eye ORDER BY date DESC LIMIT 5"),
    all(db, "SELECT test, date, value, value_text, flag FROM labs WHERE test IN ('Hematocrit','LDL','HDL','ApoB','A1C','Fasting glucose','Testosterone, total') ORDER BY test, date DESC"),
    all(db, "SELECT * FROM body_comp ORDER BY date DESC LIMIT 5"),
  ]);
  const latest = {};
  for (const l of labs) if (!latest[l.test]) latest[l.test] = l;
  return { scans, eye, key_labs: Object.values(latest), scale_body_comp: bc };
}
