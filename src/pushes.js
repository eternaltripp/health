// Afternoon pushes (brief section 3). Each kind sends at most once per date (push_log).
import { addDays, chicagoDate, sendPush } from "./util.js";
import { evaluate } from "./rules.js";
import { weekStart } from "./models.js";

const first = (db, sql, ...b) => db.prepare(sql).bind(...b).first();
const all = async (db, sql, ...b) => (await db.prepare(sql).bind(...b).all()).results || [];
const fmt = (n) => Math.round(n).toLocaleString("en-US");

async function setting(db, key) {
  const r = await first(db, "SELECT value FROM settings WHERE key=?", key);
  return r ? r.value : null;
}

async function once(env, date, kind, title, text, { force = false } = {}) {
  const db = env.DB;
  if (!force) {
    const done = await first(db, "SELECT sent_at FROM push_log WHERE date=? AND kind=?", date, kind);
    if (done) return { skipped: "already sent", kind, sent_at: done.sent_at };
  }
  const r = await sendPush(env, text, title);
  if (!r.ok) return { error: r.reason || r.status, kind };
  await db.prepare("INSERT INTO push_log (date, kind, text) VALUES (?,?,?) ON CONFLICT(date, kind) DO UPDATE SET sent_at=datetime('now'), text=excluded.text").bind(date, kind, text).run();
  return { sent: true, kind, channel: r.channel, text };
}

// ---- 3.1 Friday 3:00 pm: weekend plan ----
export async function weekendPlanText(db, date) {
  const plan = await evaluate(db, date);
  const target = plan.calorie_target;
  const mon = weekStart(date);
  const spent = await first(db, "SELECT COALESCE(SUM(cal),0) c FROM food WHERE date BETWEEN ? AND ?", mon, addDays(date, -1));
  const today = await first(db, "SELECT COALESCE(SUM(cal),0) c FROM food WHERE date=?", date);
  const budget = target * 7;
  const left = budget - spent.c - today.c;
  const friRest = Math.max(0, target - today.c); // assume the rest of Friday lands on target
  const weekend = left - friRest;
  let each = Math.round(weekend / 2 / 10) * 10;
  const floor = plan.calorie_floor || 1700;
  const over = each < floor;
  if (over) each = floor;
  const sat = addDays(date, 1), sun = addDays(date, 2);
  const plans = await all(db, "SELECT date, name FROM food WHERE restaurant=1 AND date IN (?,?) ORDER BY date, id", sat, sun);
  const notes = await all(db, "SELECT date, note FROM days WHERE date IN (?,?) AND note IS NOT NULL AND note<>''", sat, sun);
  const out = [];
  if (plans.length) out.push("Restaurant plans: " + plans.map((p) => `${p.date === sat ? "Sat" : "Sun"} ${p.name}`).join(", ") + ".");
  if (notes.length) out.push("Notes: " + notes.map((n) => `${n.date === sat ? "Sat" : "Sun"} ${n.note.split("\n")[0].slice(0, 80)}`).join(", ") + ".");
  const text = `Weekend plan. ${fmt(Math.max(0, left))} cal left in this week's ${fmt(budget)} budget (finish today near ${fmt(target)}). ` +
    (over ? `That's under the ${fmt(floor)} floor, so eat ${fmt(floor)} Sat and Sun and call the week a little over. ` : `Saturday ${fmt(each)}, Sunday ${fmt(each)}. `) +
    `Protein ${plan.protein_target} g both days, cans before restaurant meals.` + (out.length ? " " + out.join(" ") : " No restaurant plans logged. Tell Claude if you have one.");
  return { text, budget, spent_mon_thu: spent.c, friday_so_far: today.c, left, saturday: each, sunday: each, under_floor: over, restaurant_plans: plans };
}

export async function weekendPush(env, date = chicagoDate(), opts = {}) {
  if ((await setting(env.DB, "push_friday_enabled")) === "0") return { skipped: "push_friday_enabled is 0" };
  const w = await weekendPlanText(env.DB, date);
  return once(env, date, "friday_weekend", "Weekend plan", w.text, opts);
}

// ---- 3.2 weekdays 3:30 pm: dinner out? ----
export async function dinnerPush(env, date = chicagoDate(), opts = {}) {
  const db = env.DB;
  if ((await setting(db, "push_dinner_prompt_enabled")) === "0") return { skipped: "push_dinner_prompt_enabled is 0" };
  const dinner = await first(db, "SELECT COUNT(*) n FROM food WHERE date=? AND meal='dinner'", date);
  if (dinner.n > 0 && !opts.ignoreDinner) return { skipped: "dinner already logged" };
  const plan = await evaluate(db, date);
  const eaten = await first(db, "SELECT COALESCE(SUM(cal),0) c, COALESCE(SUM(protein_g),0) p FROM food WHERE date=?", date);
  const left = Math.max(0, plan.calorie_target - eaten.c), pLeft = Math.max(0, plan.protein_target - eaten.p);
  const text = `Dinner out tonight? Tell Claude where and it'll pick an order. You have about ${fmt(left)} cal and ${fmt(pLeft)} g protein left.`;
  return once(env, date, "dinner_prompt", "Dinner", text, opts);
}
