import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { chicagoDate, addDays, isYmd } from "./util.js";
import { upsertDay, appendNote, foodTotals, getDay, getWeek, getTrends, getLabs, getMeds, getLifts, TREND_METRICS, logFood, logLift, logBp, deleteEntry } from "./data.js";
import { syncAll } from "./sync.js";

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

  return server;
}

/** Stateless Streamable HTTP: a fresh server + transport per request. */
export async function handleMcp(request, env) {
  const server = buildServer(env);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
}
