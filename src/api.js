// JSON API for the web page. Only reachable after verifyAccess() passes.
import { chicagoDate, isYmd, json } from "./util.js";
import { getDay, getWeek, getTrends, upsertDay, logFood, logLift, logBp, deleteEntry, exerciseHistory } from "./data.js";
import { syncAll } from "./sync.js";

// Per-can numbers: 130 cal / 30 g are the old tracker's; 95 mg sodium is from the
// "x4 (Genius Gourmet)" entry already in the log (380 mg for 4).
const CAN = { cal: 130, p: 30, na: 95 };
const MEALS = new Set(["breakfast", "lunch", "dinner", "snack", "shake", "other"]);
const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
const bad = (msg) => json({ error: msg }, 400);

export async function handleApi(request, env, path) {
  const db = env.DB;
  const url = new URL(request.url);
  const q = (k) => url.searchParams.get(k);
  const date = (v) => (isYmd(v) ? v : chicagoDate());
  const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};

  if (request.method === "GET") {
    if (path === "/api/day") return json(await getDay(db, date(q("date"))));
    if (path === "/api/week") return json(await getWeek(db, date(q("end"))));
    if (path === "/api/trend") {
      const days = num(q("days") || 28, 2, 365) || 28;
      return json(await getTrends(db, q("metric") || "weight", days));
    }
    if (path === "/api/exercises") return json({ exercises: await exerciseHistory(db) });
  }

  if (request.method === "POST") {
    if (path === "/api/food") {
      const items = (body.items || []).map((i) => ({
        name: String(i.name || "").trim().slice(0, 300),
        cal: num(i.cal, 0, 10000), protein_g: num(i.protein_g, 0, 1000),
        sodium_mg: i.sodium_mg === "" || i.sodium_mg == null ? null : num(i.sodium_mg, 0, 20000),
        est: i.est !== false, source: "web",
      }));
      if (!items.length || items.some((i) => !i.name || i.cal == null || i.protein_g == null)) return bad("each item needs name, cal, protein_g");
      const meal = MEALS.has(body.meal) ? body.meal : "other";
      return json({ logged: await logFood(db, date(body.date), meal, items) });
    }
    if (path === "/api/lift") {
      const exercise = String(body.exercise || "").trim().slice(0, 100);
      const sets = (body.sets || []).map((s) => ({ weight_lb: num(s.weight_lb, 0, 2000), reps: num(s.reps, 0, 200), rpe: s.rpe ? num(s.rpe, 1, 10) : null, note: s.note ? String(s.note).slice(0, 200) : null }));
      if (!exercise || !sets.length || sets.some((s) => s.weight_lb == null || s.reps == null)) return bad("exercise and sets with weight and reps required");
      return json({ sets_today: await logLift(db, date(body.date), exercise, sets, "web") });
    }
    if (path === "/api/bp") {
      const sys = num(body.sys, 60, 260), dia = num(body.dia, 30, 160);
      if (sys == null || dia == null) return bad("sys and dia required");
      const now = new Date();
      return json(await logBp(db, now, chicagoDate(now), sys, dia, body.pulse ? num(body.pulse, 20, 220) : null, body.note || null, "web"));
    }
    if (path === "/api/day") {
      const f = {};
      for (const [k, lo, hi] of [["weight", 80, 500], ["water_oz", 0, 400], ["wine_glasses", 0, 30], ["sauna_min", 0, 300], ["steps", 0, 100000]]) {
        if (body[k] !== undefined) f[k] = body[k] === "" || body[k] === null ? null : num(body[k], lo, hi);
      }
      if (body.note !== undefined) f.note = String(body.note).slice(0, 4000);
      await upsertDay(db, date(body.date), f);
      return json({ ok: true });
    }
    if (path === "/api/delete") {
      const row = await deleteEntry(db, body.kind, Number(body.id));
      return row ? json({ deleted: row.id }) : json({ error: "not found" }, 404);
    }
    if (path === "/api/cans") {
      // Protein cans: +1 adds one can row; -1 removes one can (shrinks an "xN" row
      // left over from the old tracker, or deletes the latest single-can row).
      const d = date(body.date), delta = Number(body.delta);
      const rows = (await db.prepare("SELECT id, name, cal, protein_g, sodium_mg FROM food WHERE date=? AND name LIKE 'Sparkling protein can%' ORDER BY id DESC").bind(d).all()).results;
      const count = (r) => { const m = /x(\d+)/i.exec(r.name); return m ? Number(m[1]) : 1; };
      if (delta > 0) {
        await logFood(db, d, "snack", [{ name: "Sparkling protein can (Genius Gourmet)", cal: CAN.cal, protein_g: CAN.p, sodium_mg: CAN.na, est: false, source: "web" }]);
      } else if (rows.length) {
        const r = rows[0], n = count(r);
        if (n > 1) {
          const k = (n - 1) / n;
          await db.prepare("UPDATE food SET name=?, cal=?, protein_g=?, sodium_mg=? WHERE id=?")
            .bind(r.name.replace(/x\d+/i, "x" + (n - 1)), r.cal * k, r.protein_g * k, r.sodium_mg == null ? null : r.sodium_mg * k, r.id).run();
        } else {
          await deleteEntry(db, "food", r.id);
        }
      }
      const after = (await db.prepare("SELECT name FROM food WHERE date=? AND name LIKE 'Sparkling protein can%'").bind(d).all()).results;
      const total = after.reduce((a, r) => a + count(r), 0);
      await upsertDay(db, d, { cans: total });
      return json({ cans: total });
    }
    if (path === "/api/sync") return json(await syncAll(env, { days: 2, trigger: "web" }));
  }
  return json({ error: "not found" }, 404);
}
