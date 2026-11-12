// 4.1 Four Horsemen scorecard. Status per item:
//  "lab flag"   = the lab report's own H/L flag (the lab's reference range is the source)
//  BP < 130/80  = 2017 ACC/AHA stage 1 cutoff (RESEARCHED, same as rule 4 in docs/phase2-rules-research.md)
//  sleep >= 7 h = AASM/SRS adult consensus 2015 (RESEARCHED, same doc, rule 13)
//  hematocrit   = rule 5 thresholds (RESEARCHED, same doc)
// Nothing here invents a target. Items with no sourced cutoff show the value only.
import { addDays } from "./util.js";
import { modelSummary } from "./models.js";
import { T } from "./rules.js";
import { capacityStatus } from "./data.js";

const all = async (db, sql, ...b) => (await db.prepare(sql).bind(...b).all()).results || [];
const first = (db, sql, ...b) => db.prepare(sql).bind(...b).first();
const r1 = (n) => (n == null ? null : Math.round(n * 10) / 10);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

async function lab(db, test) {
  const r = await first(db, "SELECT date, value, value_text, unit, flag, note FROM labs WHERE test=? ORDER BY date DESC LIMIT 1", test);
  if (!r) return { item: test, value: null, status: "not tested", source: null };
  const status = r.flag === "H" ? "high (lab flag)" : r.flag === "L" ? "low (lab flag)" : "in lab range";
  return { item: test, value: r.value ?? r.value_text, unit: r.unit, date: r.date, status, source: "lab report flag" };
}

export async function getScorecard(db, date) {
  const start14 = addDays(date, -13);
  const bp = await first(db, "SELECT AVG(sys) sys, AVG(dia) dia, COUNT(*) n, COUNT(DISTINCT date) days FROM bp WHERE date BETWEEN ? AND ?", start14, date);
  const sleep = await all(db, "SELECT total_sleep_min m FROM oura WHERE date BETWEEN ? AND ? AND total_sleep_min IS NOT NULL", start14, date);
  const hrv = await all(db, "SELECT date, hrv FROM oura WHERE date BETWEEN ? AND ? AND hrv > 0 ORDER BY date", addDays(date, -59), date);
  const waist = await first(db, "SELECT date, waist_in FROM days WHERE waist_in IS NOT NULL AND date<=? ORDER BY date DESC LIMIT 1", date);
  const models = await modelSummary(db, date);
  const cac = await first(db, "SELECT date, value FROM labs WHERE test='Coronary calcium score' ORDER BY date DESC LIMIT 1");
  const colo = await first(db, "SELECT date, value_text FROM labs WHERE test='Colonoscopy' ORDER BY date DESC LIMIT 1");

  const bpSys = r1(bp.sys), bpDia = r1(bp.dia);
  const bpItem = { item: "Home BP, 14-day avg", value: bp.n ? `${Math.round(bpSys)}/${Math.round(bpDia)}` : null, n_readings: bp.n, days: bp.days,
    status: !bp.n ? "no readings" : bpSys >= T.bpSys || bpDia >= T.bpDia ? "at or above 130/80" : "under 130/80", source: "2017 ACC/AHA (RESEARCHED)" };
  const sleepAvg = mean(sleep.map((s) => s.m));
  const sleepItem = { item: "Sleep, 14-day avg", value: sleepAvg != null ? r1(sleepAvg / 60) : null, unit: "h", n: sleep.length,
    status: sleepAvg == null ? "no data" : sleepAvg >= 420 ? "7 h or more" : "under 7 h", source: "AASM/SRS 2015 (RESEARCHED)" };
  const last7 = mean(hrv.filter((h) => h.date > addDays(date, -7)).map((h) => h.hrv));
  const base60 = mean(hrv.map((h) => h.hrv));
  const hrvItem = { item: "HRV trend", value: r1(last7), unit: "ms (7-day avg)", baseline_60d: r1(base60), n: hrv.length,
    status: last7 == null ? "no data" : "see rule 9 for the band", source: "rule 9 (RESEARCHED)" };
  const hct = await lab(db, "Hematocrit");
  if (hct.value != null) hct.status = hct.value >= T.hctUrgent ? "urgent (54+)" : hct.value > T.hctAct ? "over 52" : hct.value > T.hctWatch ? "over 50" : "50 or under", hct.source = "rule 5 (RESEARCHED)";

  const cacDue = "Repeat wanted by Dr. Grubbs at the end of 2026";
  return {
    date,
    banner: "Familial hypercholesterolemia is in the chart. ApoB / Lp(a): NOT TESTED. Ask for both at the January labs.",
    heart: [
      { item: "ApoB", value: null, status: "NOT TESTED", source: null },
      { item: "Lp(a)", value: null, status: "NOT TESTED", source: null },
      await lab(db, "LDL"), await lab(db, "Non-HDL"), await lab(db, "HDL"),
      bpItem,
      { item: "Coronary calcium (CAC)", value: cac ? cac.value : null, date: cac ? cac.date : null, status: cac ? (cac.value === 0 ? "0" : "above 0") : "not tested", due: cacDue },
    ],
    metabolic: [
      await lab(db, "Fasting glucose"),
      { item: "Fasting insulin", value: null, status: "not tested", source: null },
      await lab(db, "A1C"), await lab(db, "Triglycerides"),
      { item: "Waist", value: waist ? waist.waist_in : null, unit: "in", date: waist ? waist.date : null, status: waist ? "logged" : "not logged yet (log_day waist_in)" },
      { item: "Trend weight", value: models.trend_weight ? models.trend_weight.value : null, unit: "lb", date: models.trend_weight ? models.trend_weight.date : null, status: "Kalman trend" },
    ],
    brain: [sleepItem, { ...bpItem, item: "BP (same 14-day avg)" }, hrvItem],
    cancer: [
      { item: "Colonoscopy", value: colo ? colo.value_text : null, date: colo ? colo.date : null, status: colo ? "next ~2035" : "none on file" },
      await lab(db, "PSA"),
    ],
    also: [hct],
    capacity: await capacityStatus(db, date),
  };
}
