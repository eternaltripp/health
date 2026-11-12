// Phase 2 rules engine. Thresholds and sources are in docs/phase2-rules-research.md.
// evaluate() is read-only. applyRule1() is the only thing that changes a setting,
// and it runs from the morning cron (or run_rules with apply=true).
import { addDays, chicagoDate } from "./util.js";

const all = async (db, sql, ...b) => (await db.prepare(sql).bind(...b).all()).results || [];
const first = (db, sql, ...b) => db.prepare(sql).bind(...b).first();
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const sd = (xs) => { const m = mean(xs); return xs.length > 1 ? Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1)) : null; };
const r1 = (n) => (n == null ? null : Math.round(n * 10) / 10);

// Thresholds. Each one is labeled in the research doc.
export const T = {
  lossRateLowPct: 0.5, lossRateHighPct: 1.0, calStep: 150, calChangeMinDays: 14, minWeighInsPerWeek: 4,   // rule 1
  leanMdcLb: 2.5,                                                                                          // rule 2
  bpSys: 130, bpDia: 80, minBpDaysPerWeek: 4,                                                              // rule 4
  hctWatch: 50, hctAct: 52, hctUrgent: 54,                                                                 // rule 5
  cpapAhi: 5, cpapMinHours: 4, cpapNights: 3, cpapCompliancePct: 70,                                        // rule 6
  glucoseHigh: 140, glucoseTarPct: 10,                                                                     // rule 7
  hrvSwcSd: 0.5, hrvBaselineDays: 60, rhrBump: 5, rhrDays: 3,                                              // rule 9
  walkKcalPerKgKm: 0.5, stepsPerKm: 1300, stepBonusShare: 0.5,                                             // step bonus
  shortSleepMin: 360,                                                                                      // rule 13: <= 6 h (Craven 2022, AASM/SRS 2015)
};

export async function getSettings(db) {
  const rows = await all(db, "SELECT key, value FROM settings");
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const n = (k, d) => (s[k] === undefined || s[k] === "" || s[k] === null ? d : Number(s[k]));
  return {
    raw: s,
    calorie_base: n("calorie_base", 1900), calorie_floor: n("calorie_floor", 1700), calorie_adjust: n("calorie_adjust", 0),
    calorie_adjust_changed: s.calorie_adjust_changed || "", protein_target: n("protein_target", 230), step_baseline: n("step_baseline", 5300),
    sodium_cap_default: n("sodium_cap_default", 2300), sodium_cap_low: n("sodium_cap_low", 1500),
    apob_target: n("apob_target", null), wine_weekly_cap: n("wine_weekly_cap", null), push_enabled: s.push_enabled !== "0",
  };
}

async function weeklyWeight(db, end) {
  // [this week (end-6..end), last week, the week before]
  const out = [];
  for (let w = 0; w < 3; w++) {
    const e = addDays(end, -7 * w), s = addDays(e, -6);
    const rows = await all(db, "SELECT weight FROM days WHERE date BETWEEN ? AND ? AND weight IS NOT NULL", s, e);
    out.push({ start: s, end: e, n: rows.length, avg: mean(rows.map((r) => r.weight)) });
  }
  return out;
}

// ---- individual rules: each returns { id, name, status, message, input } ----
// status: ok | watch | act | urgent | no_data | not_live

async function rule1(db, date, st) {
  const w = await weeklyWeight(db, date);
  const ok = w.every((x) => x.n >= T.minWeighInsPerWeek);
  const base = { id: 1, name: "Weight-loss rate" };
  if (!ok) return { ...base, status: "no_data", message: `Need ${T.minWeighInsPerWeek}+ weigh-ins in each of the last 3 weeks.`, input: w };
  const rate = (a, b) => ((b.avg - a.avg) / b.avg) * 100; // % of body weight lost per week (positive = losing)
  const r0 = rate(w[0], w[1]), r1w = rate(w[1], w[2]);
  const input = { weekly_loss_pct: [r1(r0), r1(r1w)], avg_weight: w.map((x) => r1(x.avg)), band_pct: [T.lossRateLowPct, T.lossRateHighPct] };
  if (r0 < T.lossRateLowPct && r1w < T.lossRateLowPct) return { ...base, status: "act", action: "cut", message: `Loss under ${T.lossRateLowPct}%/wk two weeks running: cut ${T.calStep} cal/day.`, input };
  if (r0 > T.lossRateHighPct && r1w > T.lossRateHighPct) return { ...base, status: "act", action: "add", message: `Loss over ${T.lossRateHighPct}%/wk two weeks running: add ${T.calStep} cal/day back.`, input };
  return { ...base, status: "ok", message: "Loss rate in range or not two weeks running.", input };
}

/** Applies rule 1 to calorie_adjust at most once per 14 days. Returns what changed. */
export async function applyRule1(db, date, r, st) {
  if (r.status !== "act") return null;
  if (st.calorie_adjust_changed && st.calorie_adjust_changed > addDays(date, -T.calChangeMinDays)) return { skipped: "changed within 14 days" };
  let adj = st.calorie_adjust + (r.action === "cut" ? -T.calStep : T.calStep);
  if (r.action === "add" && adj > 0) adj = 0; // "add back" never goes above the base
  if (st.calorie_base + adj < st.calorie_floor) adj = st.calorie_floor - st.calorie_base;
  if (adj === st.calorie_adjust) return { skipped: "at limit" };
  await db.batch([
    db.prepare("UPDATE settings SET value=?, updated_at=datetime('now') WHERE key='calorie_adjust'").bind(String(adj)),
    db.prepare("UPDATE settings SET value=?, updated_at=datetime('now') WHERE key='calorie_adjust_changed'").bind(date),
  ]);
  return { from: st.calorie_adjust, to: adj };
}

async function rule2(db) {
  const s = await all(db, "SELECT date, lean_mass FROM scans WHERE lean_mass IS NOT NULL ORDER BY date DESC LIMIT 3");
  const base = { id: 2, name: "Lean mass (scans)" };
  if (s.length < 3) return { ...base, status: "no_data", message: `Need 3 scans with lean mass (have ${s.length}).`, input: s };
  const d1 = s[0].lean_mass - s[1].lean_mass, d2 = s[1].lean_mass - s[2].lean_mass, total = s[0].lean_mass - s[2].lean_mass;
  const input = { scans: s, change_lb: r1(total) };
  if (d1 < 0 && d2 < 0 && -total >= T.leanMdcLb) return { ...base, status: "act", message: `Lean mass down on 2 scans (${r1(-total)} lb, past the ${T.leanMdcLb} lb noise floor): deficit 200 smaller, +1 set per muscle group.`, input };
  return { ...base, status: "ok", message: "No lean-mass loss beyond measurement noise.", input };
}

async function rule3(db, date) {
  const targets = await all(db, "SELECT * FROM lift_targets");
  const base = { id: 3, name: "Lift progression" };
  const items = [];
  for (const t of targets) {
    const sessions = await all(db, "SELECT DISTINCT date FROM lifts WHERE exercise=? AND date<=? ORDER BY date DESC LIMIT 2", t.exercise, date);
    if (sessions.length < 2) continue;
    const sets = await Promise.all(sessions.map((s) => all(db, "SELECT weight_lb, reps FROM lifts WHERE exercise=? AND date=?", t.exercise, s.date)));
    const top = sets.map((ss) => Math.max(...ss.map((x) => x.weight_lb)));
    // working sets = sets at the session's top weight
    const hit = sets.every((ss, i) => ss.filter((x) => x.weight_lb === top[i]).every((x) => x.reps >= t.rep_high));
    const missed = sets.every((ss, i) => ss.filter((x) => x.weight_lb === top[i]).some((x) => x.reps < t.rep_low));
    if (hit) {
      const inc = Math.max(t.increment_lb || 5, Math.round((top[0] * 0.025) / 5) * 5);
      items.push({ exercise: t.exercise, status: "act", message: `${t.exercise}: top of range 2 sessions running. Go ${top[0]} → ${top[0] + inc} lb.` });
    } else if (missed) {
      items.push({ exercise: t.exercise, status: "watch", message: `${t.exercise}: below ${t.rep_low} reps 2 sessions running. Consider a lighter load (deload size not set; no sourced number).` });
    }
  }
  if (!items.length) return { ...base, status: "ok", message: "No progression changes due.", input: { checked: targets.length } };
  return { ...base, status: items.some((i) => i.status === "act") ? "act" : "watch", message: items.map((i) => i.message).join(" "), input: items };
}

async function bpWeeks(db, end) {
  const out = [];
  for (let w = 0; w < 2; w++) {
    const e = addDays(end, -7 * w), s = addDays(e, -6);
    const r = await first(db, "SELECT AVG(sys) sys, AVG(dia) dia, COUNT(DISTINCT date) days FROM bp WHERE date BETWEEN ? AND ?", s, e);
    out.push({ start: s, end: e, sys: r1(r.sys), dia: r1(r.dia), days: r.days });
  }
  return out;
}
async function rule4(db, date) {
  const w = await bpWeeks(db, date);
  const base = { id: 4, name: "Blood pressure" };
  if (w.some((x) => x.days < T.minBpDaysPerWeek)) return { ...base, status: "no_data", message: `Need BP on ${T.minBpDaysPerWeek}+ days in each of the last 2 weeks.`, input: w };
  const high = (x) => x.sys >= T.bpSys || x.dia >= T.bpDia;
  if (high(w[0]) && high(w[1])) return { ...base, status: "act", lowSodium: true, message: "7-day BP average at or above 130/80 two weeks running: sodium cap 1,500 mg, add Zone 2, flag for Dr. Grubbs.", input: w };
  if (high(w[0])) return { ...base, status: "watch", message: "This week's BP average is at or above 130/80.", input: w };
  return { ...base, status: "ok", message: "BP average under 130/80.", input: w };
}

async function rule5(db) {
  const h = await first(db, "SELECT date, value FROM labs WHERE test='Hematocrit' AND value IS NOT NULL ORDER BY date DESC LIMIT 1");
  const base = { id: 5, name: "Hematocrit" };
  if (!h) return { ...base, status: "no_data", message: "No hematocrit on file.", input: null };
  const v = h.value, input = { latest: h };
  if (v >= T.hctUrgent) return { ...base, status: "urgent", message: `Hematocrit ${v} (${h.date}) is at the guideline hold-therapy level. Call Dr. Grubbs.`, input };
  if (v > T.hctAct) return { ...base, status: "act", message: `Hematocrit ${v} (${h.date}) over 52: talk to Dr. Grubbs.`, input };
  if (v > T.hctWatch) return { ...base, status: "watch", message: `Hematocrit ${v} (${h.date}) over 50: recheck.`, input };
  return { ...base, status: "ok", message: `Latest hematocrit ${v} (${h.date}).`, input };
}

async function rule6(db, date) {
  const nights = await all(db, "SELECT date, hours, ahi FROM cpap WHERE date BETWEEN ? AND ? ORDER BY date DESC", addDays(date, -30), addDays(date, -1));
  const base = { id: 6, name: "CPAP" };
  if (nights.length < T.cpapNights) return { ...base, status: "no_data", message: "Not enough CPAP nights.", input: nights.length };
  const last3 = nights.slice(0, T.cpapNights);
  const ahiHigh = last3.every((n) => n.ahi != null && n.ahi > T.cpapAhi);
  const short = last3.every((n) => (n.hours ?? 0) < T.cpapMinHours);
  const compliant = nights.filter((n) => (n.hours ?? 0) >= T.cpapMinHours).length;
  const pct = Math.round((compliant / 30) * 100);
  const input = { last3, compliance_30d_pct: pct, nights_logged_30d: nights.length };
  const msgs = [];
  if (ahiHigh) msgs.push("AHI over 5 three nights running: check mask and leak, call VieMed.");
  if (short) msgs.push("Under 4 hours three nights running.");
  if (nights.length >= 28 && pct < T.cpapCompliancePct) msgs.push(`30-day compliance ${pct}% (under 70%).`);
  if (msgs.length) return { ...base, status: "act", message: msgs.join(" "), input };
  return { ...base, status: "ok", message: `30-day compliance ${pct}%.`, input };
}

async function rule7(db, date) {
  const base = { id: 7, name: "Glucose (CGM)" };
  const day = addDays(date, -1);
  const rows = await all(db, "SELECT ts, mg_dl FROM glucose WHERE date=? ORDER BY ts", day);
  if (!rows.length) return { ...base, status: "no_data", message: "No glucose readings yesterday.", input: null };
  const highs = rows.filter((r) => r.mg_dl > T.glucoseHigh);
  const tar = Math.round((highs.length / rows.length) * 100);
  const input = { date: day, readings: rows.length, over_140: highs.length, time_above_pct: tar, peak: Math.max(...rows.map((r) => r.mg_dl)) };
  if (tar > T.glucoseTarPct) return { ...base, status: "act", message: `Yesterday ${tar}% of readings were over 140 (healthy median is about 2%). Swap the culprit meals, protein first, 10-min walk after.`, input };
  if (highs.length) return { ...base, status: "watch", message: "A reading went over 140 yesterday. Check the meal before it: swap it, protein first, 10-min walk after.", input };
  return { ...base, status: "ok", message: "No readings over 140 yesterday.", input };
}

async function rule8(db, st) {
  const base = { id: 8, name: "ApoB" };
  if (st.apob_target == null) return { ...base, status: "not_live", message: "No ApoB target set (needs your cardiologist's risk category).", input: null };
  const rows = await all(db, "SELECT date, value FROM labs WHERE test='ApoB' AND value IS NOT NULL ORDER BY date");
  if (!rows.length) return { ...base, status: "no_data", message: "No ApoB result yet (January labs).", input: null };
  const last = rows[rows.length - 1], firstD = rows[0].date;
  const input = { latest: last, target: st.apob_target, first_test: firstD };
  if (last.value > st.apob_target && last.date >= addDays(firstD, 90)) return { ...base, status: "act", message: `ApoB ${last.value} above your ${st.apob_target} target after 3+ months: statin discussion.`, input };
  return { ...base, status: last.value > st.apob_target ? "watch" : "ok", message: `ApoB ${last.value} vs target ${st.apob_target}.`, input };
}

async function rule9(db, date) {
  const base = { id: 9, name: "Readiness (HRV, resting HR)" };
  const rows = await all(db, "SELECT date, hrv, rhr FROM oura WHERE date BETWEEN ? AND ? ORDER BY date", addDays(date, -(T.hrvBaselineDays - 1)), date);
  const hrv = rows.filter((r) => r.hrv > 0);
  if (hrv.length < 21) return { ...base, status: "no_data", training: "normal", message: "Need 3+ weeks of HRV for a baseline.", input: hrv.length };
  const ln = hrv.map((r) => ({ date: r.date, v: Math.log(r.hrv) }));
  const roll = []; // 7-day rolling means of lnRMSSD
  for (let i = 6; i < ln.length; i++) roll.push(mean(ln.slice(i - 6, i + 1).map((x) => x.v)));
  const baseMean = mean(ln.map((x) => x.v)), swc = T.hrvSwcSd * sd(ln.map((x) => x.v));
  const cur = mean(ln.filter((x) => x.date > addDays(date, -7)).map((x) => x.v));
  const lower = baseMean - swc;
  const rhr = rows.filter((r) => r.rhr > 0);
  const rhrBase = mean(rhr.slice(0, -T.rhrDays).map((r) => r.rhr));
  const rhrLast = rhr.slice(-T.rhrDays);
  const rhrHigh = rhrLast.length === T.rhrDays && rhrLast.every((r) => r.rhr >= rhrBase + T.rhrBump);
  const input = {
    hrv_7d_avg_ms: r1(Math.exp(cur)), hrv_baseline_ms: r1(Math.exp(baseMean)), hrv_lower_band_ms: r1(Math.exp(lower)),
    rhr_baseline: r1(rhrBase), rhr_last3: rhrLast.map((r) => r.rhr),
  };
  if (cur < lower) return { ...base, status: "act", training: "zone2", message: "7-day HRV is below your normal band: Zone 2 today, no heavy lifting.", input };
  if (rhrHigh) return { ...base, status: "watch", training: "normal", message: "Resting HR up 5+ bpm three nights running (HRV still normal). Watch it; propranolol blunts this signal.", input };
  return { ...base, status: "ok", training: "normal", message: "HRV in your normal band.", input };
}

// Rule 13: last night's sleep. Oura dates a night by the morning you wake, so the row for `date` is last night.
async function rule13(db, date) {
  const base = { id: 13, name: "Last night's sleep" };
  const rows = await all(db, "SELECT date, total_sleep_min FROM oura WHERE date IN (?, ?)", date, addDays(date, -1));
  const last = rows.find((r) => r.date === date), prev = rows.find((r) => r.date === addDays(date, -1));
  if (!last || last.total_sleep_min == null) return { ...base, status: "no_data", training: "normal", sleepReady: false, message: "Last night's Oura sleep isn't in yet.", input: null };
  const h = (m) => Math.round((m / 60) * 10) / 10;
  const short = (r) => r && r.total_sleep_min != null && r.total_sleep_min <= T.shortSleepMin;
  const input = { last_night_h: h(last.total_sleep_min), night_before_h: prev && prev.total_sleep_min != null ? h(prev.total_sleep_min) : null, threshold_h: T.shortSleepMin / 60 };
  if (short(last) && short(prev)) return { ...base, status: "act", training: "zone2", sleepReady: true, message: "6 h or less two nights running: Zone 2 today, no heavy lifting (repeated short nights cut strength on compound lifts).", input };
  if (short(last)) return { ...base, status: "watch", training: "lighter", sleepReady: true, message: "6 h or less last night: lift, but skip top sets and PR attempts, and lift in the morning if you can.", input };
  return { ...base, status: "ok", training: "normal", sleepReady: true, message: `Slept ${input.last_night_h} h.`, input };
}

const DRINK = /\b(wine|cabernet|merlot|pinot|xinomavro|port|beer|guinness|ipa|lager|whiskey|whisky|bourbon|scotch|vodka|gin|tequila|margarita|cocktail|smash|old fashioned|martini|sangria|champagne|prosecco)\b/i;
export async function alcoholReport(db, date, days = 60) {
  const start = addDays(date, -(days - 1));
  const [dayRows, food, oura] = await Promise.all([
    all(db, "SELECT date, wine_glasses FROM days WHERE date BETWEEN ? AND ?", start, date),
    all(db, "SELECT date, name FROM food WHERE date BETWEEN ? AND ?", start, date),
    all(db, "SELECT date, hrv, rhr FROM oura WHERE date BETWEEN ? AND ?", start, addDays(date, 1)),
  ]);
  const drink = new Set([...dayRows.filter((d) => d.wine_glasses > 0).map((d) => d.date), ...food.filter((f) => DRINK.test(f.name)).map((f) => f.date)]);
  const O = Object.fromEntries(oura.map((o) => [o.date, o]));
  const after = (set, wantDrink) => {
    const out = [];
    for (let d = start; d < date; d = addDays(d, 1)) if (set.has(d) === wantDrink && O[addDays(d, 1)]) out.push(O[addDays(d, 1)]);
    return out;
  };
  const wet = after(drink, true), dry = after(drink, false);
  const m = (arr, k) => r1(mean(arr.map((x) => x[k]).filter((v) => v > 0)));
  return {
    window: { start, end: date }, drink_nights: wet.length, dry_nights: dry.length,
    next_morning_hrv: { after_drinks: m(wet, "hrv"), after_dry: m(dry, "hrv") },
    next_morning_rhr: { after_drinks: m(wet, "rhr"), after_dry: m(dry, "rhr") },
    enough_data: wet.length >= 5 && dry.length >= 5,
    note: "Drink nights = wine_glasses logged or a food item naming a drink. Oura dates are the morning after.",
  };
}

/** Step bonus (half of net walking burn over the baseline), from current weight. */
export function stepBonusPer1k(weightLb) {
  const kg = (weightLb || 212) / 2.2046;
  return Math.round(T.stepBonusShare * T.walkKcalPerKgKm * kg * (1000 / T.stepsPerKm));
}

export async function evaluate(db, date = chicagoDate()) {
  const st = await getSettings(db);
  const rules = [];
  for (const f of [() => rule1(db, date, st), () => rule2(db), () => rule3(db, date), () => rule4(db, date), () => rule5(db), () => rule6(db, date), () => rule7(db, date), () => rule8(db, st), () => rule9(db, date), () => rule13(db, date)]) {
    try { rules.push(await f()); } catch (e) { rules.push({ id: rules.length + 1, status: "error", message: String(e.message || e) }); }
  }
  const r4 = rules.find((r) => r.id === 4), r9 = rules.find((r) => r.id === 9), r13 = rules.find((r) => r.id === 13);
  // Training call: the most cautious of the HRV rule and the sleep rule.
  const calls = [r9 && r9.training, r13 && r13.training];
  const training_call = calls.includes("zone2") ? "Zone 2 only, no heavy lifting" : calls.includes("lighter") ? "Lift lighter: no top sets or PRs" : "Train as planned";
  const lastW = await first(db, "SELECT weight FROM days WHERE weight IS NOT NULL AND date<=? ORDER BY date DESC LIMIT 1", date);
  const calorie_target = Math.max(st.calorie_floor, st.calorie_base + st.calorie_adjust);
  const rank = { urgent: 0, act: 1, watch: 2 };
  const flagged = rules.filter((r) => rank[r.status] != null).sort((a, b) => rank[a.status] - rank[b.status]);
  return {
    date,
    training_call, sleep_ready: !!(r13 && r13.sleepReady),
    calorie_target, calorie_base: st.calorie_base, calorie_adjust: st.calorie_adjust, calorie_floor: st.calorie_floor,
    step_baseline: st.step_baseline, step_bonus_per_1k_over_baseline: stepBonusPer1k(lastW && lastW.weight),
    protein_target: st.protein_target,
    sodium_cap: r4 && r4.lowSodium ? st.sodium_cap_low : st.sodium_cap_default,
    watch_items: flagged.map((r) => ({ rule: r.id, name: r.name, status: r.status, message: r.message })),
    rules,
    not_live: ["Rule 3 deload size (no sourced number)", "Rule 6 '<6 h' and leak (no sourced threshold)", "Rule 7 '+40 spike' (no source)", "Rule 10 auto cap (you set it)", "Rule 11 HDL (tracked only)"],
    sources: "docs/phase2-rules-research.md in the repo",
  };
}

/** Runs the rules for a date, applies rule 1 if asked, stores the plan and a rules_log row per rule. Idempotent per date. */
export async function runRules(db, date = chicagoDate(), { apply = false } = {}) {
  let plan = await evaluate(db, date);
  let change = null;
  if (apply) {
    const st = await getSettings(db);
    change = await applyRule1(db, date, plan.rules.find((r) => r.id === 1), st);
    if (change && change.to != null) plan = await evaluate(db, date);
  }
  plan.calorie_change = change;
  const stmts = [db.prepare("DELETE FROM rules_log WHERE date=?").bind(date)];
  for (const r of plan.rules) stmts.push(db.prepare("INSERT INTO rules_log (date, rule, input, output) VALUES (?,?,?,?)").bind(date, `${r.id} ${r.name || ""}`.trim(), JSON.stringify(r.input ?? null), JSON.stringify({ status: r.status, message: r.message })));
  stmts.push(db.prepare("INSERT INTO plans (date, plan) VALUES (?,?) ON CONFLICT(date) DO UPDATE SET plan=excluded.plan").bind(date, JSON.stringify(plan)));
  await db.batch(stmts);
  return plan;
}

/** Push text. Targets only, no health readings (spec). */
export function pushText(plan) {
  const top = plan.watch_items[0];
  const watch = top ? `Watch: ${top.name}.` : "Nothing to watch.";
  const sleepNote = plan.sleep_ready ? "" : " No sleep data yet, so this call ignores last night. Open the Oura app and ask for a fresh plan.";
  return `${plan.training_call}.${sleepNote} Eat ${plan.calorie_target.toLocaleString("en-US")} cal, ${plan.protein_target} g protein, sodium under ${plan.sodium_cap.toLocaleString("en-US")} mg. ${watch}`;
}
