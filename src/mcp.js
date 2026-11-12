import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { chicagoDate, addDays, isYmd } from "./util.js";
import { upsertDay, appendNote, foodTotals, getDay, getWeek, getTrends, getLabs, getMeds, getLifts, TREND_METRICS, logFood, logLift, logBp, deleteEntry } from "./data.js";
import { syncAll } from "./sync.js";
import { evaluate, runRules } from "./rules.js";
import { getReview, visitPacket } from "./review.js";
import { logScan, logEye, logGlucose, getGlucose, setSetting, listSettings, setLiftTarget, listLiftTargets, SETTING_KEYS } from "./data.js";

const DateArg = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
  .describe("YYYY-MM-DD (America/Chicago). Omit for today.");
const MEALS = ["breakfast", "lunch", "dinner", "snack", "shake", "other"];

const ok = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] });
const fail = (msg) => ({ isError: true, content: [{ type: "text", text: msg }] });
const day = (d) => d || chicagoDate();

function buildServer(env) {
  const db = env.DB;
  const server = new McpServer({ name: "michael-health", version: "1.0.0" }, {
    instructions:
      "Michael's personal health database (food, lifts, blood pressure, weight, daily notes, Oura sleep/readiness, ResMed CPAP, labs, meds). " +
      "Use the log_* tools whenever he reports something he ate, a workout, a BP reading, his weight, water, wine, sauna or a daily note. " +
      "Use get_* tools before answering questions about his numbers; never guess values. Dates are America/Chicago. " +
      "Calories/protein are usually estimates: set est=false only when he gives a label or exact value.",
  });

  server.registerTool("log_food", {
    title: "Log food",
    description:
      "Record food or drink Michael ate. Call this every time he reports eating or drinking something with calories (meals, snacks, shakes, alcohol). " +
      "One call can hold several items. Estimate calories, protein and sodium if he doesn't give them, and mark est=true. Returns the day's running totals.",
    inputSchema: {
      date: DateArg,
      meal: z.enum(MEALS).describe("Which meal these items belong to."),
      items: z.array(z.object({
        name: z.string().min(1).describe("What it was, with portion, e.g. '8 oz grilled chicken breast'."),
        cal: z.number().nonnegative(),
        protein_g: z.number().nonnegative(),
        sodium_mg: z.number().nonnegative().optional(),
        est: z.boolean().default(true).describe("true = estimate, false = from label/exact"),
      })).min(1),
    },
  }, async ({ date, meal, items }) => {
    const d = day(date);
    const logged = await logFood(db, d, meal, items);
    return ok({ logged, date: d, day_totals: await foodTotals(db, d) });
  });

  server.registerTool("log_lift", {
    title: "Log lifting sets",
    description:
      "Record strength-training sets for one exercise. Call once per exercise with every set he did, in order. Set numbers continue from any sets already logged for that exercise that day.",
    inputSchema: {
      date: DateArg,
      exercise: z.string().min(1).describe("Exercise name, consistent over time, e.g. 'Bench press', 'Incline DB curl'."),
      sets: z.array(z.object({
        weight_lb: z.number().nonnegative().describe("Load in lb. 0 for bodyweight. For per-side loads put the per-side number and say so in note."),
        reps: z.number().int().nonnegative(),
        rpe: z.number().min(1).max(10).optional(),
        note: z.string().optional(),
      })).min(1),
    },
  }, async ({ date, exercise, sets }) => {
    const d = day(date);
    const n = await logLift(db, d, exercise, sets);
    return ok({ date: d, exercise, sets_logged: sets.length, sets_today: n });
  });

  server.registerTool("log_bp", {
    title: "Log blood pressure",
    description: "Record a blood pressure reading (systolic/diastolic, optional pulse). Use whenever he reports a BP reading.",
    inputSchema: {
      sys: z.number().int().min(60).max(260),
      dia: z.number().int().min(30).max(160),
      pulse: z.number().int().min(20).max(220).optional(),
      ts: z.string().optional().describe("ISO timestamp of the reading. Omit for now."),
      note: z.string().optional().describe("e.g. 'morning, seated, left arm'"),
    },
  }, async ({ sys, dia, pulse, ts, note }) => {
    const when = ts ? new Date(ts) : new Date();
    if (isNaN(when)) return fail("ts is not a valid timestamp");
    const d = chicagoDate(when);
    const r = await logBp(db, when, d, sys, dia, pulse, note);
    return ok({ id: r.id, date: d, sys, dia, pulse: pulse ?? null });
  });

  server.registerTool("log_weight", {
    title: "Log body weight",
    description: "Record his morning body weight in pounds for a day. Overwrites that day's weight if one exists.",
    inputSchema: { weight: z.number().min(80).max(500).describe("lb"), date: DateArg },
  }, async ({ weight, date }) => {
    const d = day(date);
    await upsertDay(db, d, { weight });
    return ok({ date: d, weight });
  });

  server.registerTool("log_day", {
    title: "Log daily details",
    description:
      "Set daily fields: water (oz), wine (glasses), sauna (minutes), steps (manual override), protein cans, or a note. Only the fields you pass change. " +
      "Notes append to the day's existing note unless replace_note=true.",
    inputSchema: {
      date: DateArg,
      water_oz: z.number().nonnegative().optional(),
      wine_glasses: z.number().nonnegative().optional(),
      sauna_min: z.number().nonnegative().optional(),
      steps: z.number().int().nonnegative().optional(),
      cans: z.number().int().nonnegative().optional(),
      note: z.string().optional(),
      replace_note: z.boolean().default(false),
    },
  }, async ({ date, note, replace_note, ...fields }) => {
    const d = day(date);
    await upsertDay(db, d, fields);
    if (note) replace_note ? await upsertDay(db, d, { note }) : await appendNote(db, d, note);
    return ok((await getDay(db, d)).day);
  });

  server.registerTool("get_day", {
    title: "Get one day",
    description:
      "Everything for one day: food items and totals, lifts, BP readings, weight and daily fields, Oura (sleep, readiness, HRV, resting HR, steps), and CPAP for the night before. Use for 'how am I doing today' or to check what's logged.",
    inputSchema: { date: DateArg },
  }, async ({ date }) => ok(await getDay(db, day(date))));

  server.registerTool("get_week", {
    title: "Get a 7-day summary",
    description: "Seven days ending on end_date (default today): one row per day plus averages for calories, protein, sodium, weight, BP, HRV, resting HR, sleep, steps, CPAP. Use for weekly reviews and 'how was my week'.",
    inputSchema: { end_date: DateArg },
  }, async ({ end_date }) => ok(await getWeek(db, day(end_date))));

  server.registerTool("get_trends", {
    title: "Get a metric trend",
    description: "Daily series for one metric over the last N days, with mean, min, max, last-7 and prior-7 averages. CPAP metrics are attributed to the morning the night ended.",
    inputSchema: {
      metric: z.enum(TREND_METRICS),
      days: z.number().int().min(2).max(730).default(30),
    },
  }, async ({ metric, days }) => ok(await getTrends(db, metric, days)));

  server.registerTool("get_labs", {
    title: "Get lab results",
    description: "Lab history (lipids, glucose/A1C, CBC incl. hematocrit, kidney/liver, hormones, imaging). Filter by test or panel name (partial match). Also returns the current med and supplement list unless include_meds=false.",
    inputSchema: {
      test: z.string().optional().describe("e.g. 'hematocrit', 'LDL', 'testosterone'"),
      panel: z.string().optional().describe("e.g. 'lipid', 'cbc', 'hormone', 'imaging'"),
      include_meds: z.boolean().default(true),
      include_stopped_meds: z.boolean().default(false),
    },
  }, async ({ test, panel, include_meds, include_stopped_meds }) => ok({
    labs: await getLabs(db, { test, panel }),
    meds: include_meds ? await getMeds(db, include_stopped_meds) : undefined,
  }));

  server.registerTool("get_lifts", {
    title: "Get lifting history",
    description: "Lifting sessions grouped by exercise and date, last N days. Filter by exercise (partial match). Use to plan the next session's weights or check progress.",
    inputSchema: {
      exercise: z.string().optional(),
      days: z.number().int().min(1).max(730).default(90),
    },
  }, async ({ exercise, days }) => ok({ sessions: await getLifts(db, { exercise, days }) }));

  server.registerTool("sync_now", {
    title: "Sync Oura and CPAP now",
    description: "Pull Oura (sleep, readiness, HRV, resting HR, steps) and ResMed myAir CPAP (hours, AHI, leak, mask-off) into the database right now. Runs automatically at 6 a.m. Central; call this if today's data looks missing or he asks to refresh. Safe to re-run.",
    inputSchema: {
      days: z.number().int().min(1).max(120).default(3).describe("How many days back to pull, including today."),
      start_date: DateArg.describe("Optional explicit start date (overrides days), for backfills."),
    },
  }, async ({ days, start_date }) => ok(await syncAll(env, { days, start: start_date, trigger: "sync_now" })));

  server.registerTool("delete_entry", {
    title: "Delete a logged entry",
    description: "Delete one mistaken food, lift or BP entry by id (ids come from get_day / get_lifts). Only use when he asks to remove or correct an entry.",
    inputSchema: { kind: z.enum(["food", "lift", "bp"]), id: z.number().int() },
  }, async ({ kind, id }) => {
    const row = await deleteEntry(db, kind, id);
    return row ? ok({ deleted: row }) : fail(`no ${kind} with id ${id}`);
  });


  // ---------------- phase 2: plan, rules, review ----------------
  server.registerTool("get_plan", {
    title: "Today's plan",
    description:
      "Today's training call (train as planned vs Zone 2), calorie target, step bonus, protein target, sodium cap, and any rule flags (weight-loss rate, lean mass, lift progression, BP, hematocrit, CPAP, glucose, ApoB, HRV/resting HR). " +
      "Use when he asks what to eat, whether to lift, how much he has left today, or what to watch. refresh=true re-runs the rules now instead of using the 6 a.m. result.",
    inputSchema: { date: DateArg, refresh: z.boolean().default(false) },
  }, async ({ date, refresh }) => {
    const d = day(date);
    if (!refresh) {
      const row = await db.prepare("SELECT plan FROM plans WHERE date=?").bind(d).first();
      if (row) return ok({ ...JSON.parse(row.plan), source: "6 a.m. run" });
    }
    return ok({ ...(await evaluate(db, d)), source: "computed now (calorie adjustments only change in the 6 a.m. run)" });
  });

  server.registerTool("get_review", {
    title: "Weekly review",
    description: "Sunday-style review for the 7 days ending end_date: weight trend, lean mass, lift bests, BP average, protein days hit, calories vs budget, next week's targets, rule flags, alcohol vs next-morning HRV/RHR, and the scoreboard.",
    inputSchema: { end_date: DateArg },
  }, async ({ end_date }) => ok(await getReview(db, day(end_date))));

  server.registerTool("get_visit_packet", {
    title: "Doctor visit packet",
    description: "Summary to bring to a doctor or eye visit: home BP average, recent hematocrit, CPAP compliance and AHI, weight change, Oura averages, active meds, eye history. Default last 30 days.",
    inputSchema: { end_date: DateArg, days: z.number().int().min(7).max(365).default(30) },
  }, async ({ end_date, days }) => ok(await visitPacket(db, day(end_date), days)));

  server.registerTool("send_push_now", {
    title: "Send today's plan push now",
    description: "Send the morning plan push notification (Pushover) (training call, calorie target, sodium cap, top watch item) to his phone right now. Use only when he asks to test or resend the push.",
    inputSchema: {},
  }, async () => {
    const { runRules: rr, pushText: pt } = await import("./rules.js");
    const d = chicagoDate();
    const row = await db.prepare("SELECT plan FROM plans WHERE date=?").bind(d).first();
    const plan = row ? JSON.parse(row.plan) : await rr(db, d, { apply: false });
    const { sendPush } = await import("./util.js");
    const r = await sendPush(env, pt(plan), "Today");
    return r.ok ? ok({ sent: true, channel: r.channel, text: pt(plan) }) : fail(`Push failed (${r.channel}): ${r.reason || r.status}`);
  });

  // ---------------- phase 4: body data ----------------
  server.registerTool("log_scan", {
    title: "Log a body scan (InBody)",
    description: "Record an InBody or similar body-composition scan. Weights in lb. smm = skeletal muscle mass, bfm = body fat mass, pbf = percent body fat, lean_mass = fat-free/lean mass.",
    inputSchema: {
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      weight: z.number().optional(), smm: z.number().optional(), bfm: z.number().optional(), pbf: z.number().optional(),
      lean_mass: z.number().optional(), trunk_fat: z.number().optional(), visceral: z.number().optional(),
      raw: z.record(z.any()).optional().describe("Any other fields from the printout"),
    },
  }, async (a) => ok({ saved: await logScan(db, a) }));

  server.registerTool("log_eye", {
    title: "Log an eye visit",
    description: "Record a retina/eye visit: whether he got an injection, the drug, the interval in weeks since the last one, OCT central thickness, and notes.",
    inputSchema: {
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), injection: z.boolean(), drug: z.string().optional(),
      interval_weeks: z.number().optional(), oct_thickness: z.number().optional(), note: z.string().optional(),
    },
  }, async (a) => ok({ saved: await logEye(db, a) }));

  server.registerTool("log_glucose", {
    title: "Log glucose readings",
    description: "Record one or many glucose readings (mg/dL) with timestamps, e.g. from a CGM export (Lingo, Stelo) or a finger stick. Re-sending the same timestamp overwrites, never duplicates.",
    inputSchema: {
      readings: z.array(z.object({ ts: z.string().describe("ISO timestamp"), mg_dl: z.number().min(20).max(600) })).min(1).max(2000),
      source: z.string().optional().describe("e.g. 'lingo', 'stelo', 'fingerstick'"),
    },
  }, async ({ readings, source }) => {
    const bad = readings.find((r) => isNaN(new Date(r.ts)));
    if (bad) return fail("bad timestamp: " + bad.ts);
    const n = await logGlucose(db, readings.map((r) => ({ ts: new Date(r.ts).toISOString(), mg_dl: r.mg_dl })), source, (ts) => chicagoDate(new Date(ts)));
    return ok({ saved: n });
  });

  server.registerTool("get_glucose", {
    title: "Get glucose for a day",
    description: "Glucose readings for one day with mean, peak, and count over 140 mg/dL.",
    inputSchema: { date: DateArg },
  }, async ({ date }) => ok(await getGlucose(db, day(date))));

  // ---------------- settings ----------------
  server.registerTool("get_settings", {
    title: "Get targets and settings",
    description: "Current calorie base/floor/adjustment, protein target, step baseline, sodium caps, ApoB target, wine cap, push on/off, and per-exercise rep ranges used by the lift progression rule.",
    inputSchema: {},
  }, async () => ok({ settings: await listSettings(db), lift_targets: await listLiftTargets(db) }));

  server.registerTool("set_setting", {
    title: "Change a target or setting",
    description: "Change one setting. Only when he explicitly asks. Keys: " + SETTING_KEYS.join(", ") + ". Use an empty string to clear (e.g. apob_target).",
    inputSchema: { key: z.enum(SETTING_KEYS), value: z.string() },
  }, async ({ key, value }) => { await setSetting(db, key, value); return ok({ key, value }); });

  server.registerTool("set_lift_target", {
    title: "Set an exercise's rep range",
    description: "Set the target rep range (and load step in lb) for an exercise. The progression rule suggests adding weight when every working set hits rep_high two sessions in a row.",
    inputSchema: { exercise: z.string().min(1), rep_low: z.number().int().min(1), rep_high: z.number().int().min(1), increment_lb: z.number().positive().optional(), note: z.string().optional() },
  }, async (a) => ok({ lift_targets: await setLiftTarget(db, a) }));

  return server;
}

/** Stateless Streamable HTTP: a fresh server + transport per request. */
export async function handleMcp(request, env) {
  const server = buildServer(env);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
}
