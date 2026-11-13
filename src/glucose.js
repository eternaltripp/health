// Glucose ingest from Health Auto Export (HAE) REST automation.
// Brief: build/glucose-pipe-test-brief-2026-11-13.md (phase 1 of the Stelo design).
// HAE JSON v2: {"data": {"metrics": [{"name": "blood_glucose", "units": "...", "data": [{"date": "yyyy-MM-dd HH:mm:ss Z", "qty": n, "source": "..."}]}]}}
// (RESEARCHED: HAE wiki "API Export - JSON Format", github.com/Lybron/health-auto-export/wiki).
import { chicagoDate, json, safeEqual } from "./util.js";

const MAX_BYTES = 5 * 1024 * 1024;
const MMOL_TO_MGDL = 18.016; // FROM MEMORY: glucose molar mass 180.16 g/mol, so 1 mmol/L = 18.016 mg/dL

// "2026-11-13 08:05:00 -0600" -> Date. Also accepts ISO strings.
export function parseHaeDate(s) {
  if (typeof s !== "string") return null;
  const m = s.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)\s*([+-]\d{2}):?(\d{2})$/);
  const d = m ? new Date(`${m[1]}T${m[2].length === 5 ? m[2] + ":00" : m[2]}${m[3]}:${m[4]}`) : new Date(s);
  return isNaN(d) ? null : d;
}

function classify(sourceApp) {
  const s = String(sourceApp || "");
  if (s === "Health") return "test";            // manual entries in the Apple Health app
  return "stelo_ah";                            // "Stelo" or anything else (source_app kept for checking)
}

async function logIngest(db, r) {
  await db.prepare("INSERT INTO glucose_ingest_log (rows_in, rows_new, rows_dup, first_ts, last_ts, rejected_reason, payload_bytes) VALUES (?,?,?,?,?,?,?)")
    .bind(r.rows_in || 0, r.rows_new || 0, r.rows_dup || 0, r.first_ts || null, r.last_ts || null, r.rejected_reason || null, r.payload_bytes || 0).run();
}

/** POST /ingest/hae */
export async function handleHaeIngest(request, env) {
  const db = env.DB;
  const auth = request.headers.get("Authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!(await safeEqual(token, (env.GLUCOSE_INGEST_TOKEN || "").trim()))) return json({ error: "unauthorized" }, 401);
  if (request.method !== "POST") return json({ error: "POST only" }, 405);

  const len = Number(request.headers.get("Content-Length") || 0);
  if (len > MAX_BYTES) { await logIngest(db, { rejected_reason: "too large", payload_bytes: len }); return json({ error: "payload over 5 MB" }, 413); }
  const text = await request.text();
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > MAX_BYTES) { await logIngest(db, { rejected_reason: "too large", payload_bytes: bytes }); return json({ error: "payload over 5 MB" }, 413); }

  let body;
  try { body = JSON.parse(text); } catch { await logIngest(db, { rejected_reason: "not JSON", payload_bytes: bytes }); return json({ error: "not JSON" }, 400); }
  const metrics = body && body.data && body.data.metrics;
  if (!Array.isArray(metrics)) { await logIngest(db, { rejected_reason: "wrong envelope (need data.metrics)", payload_bytes: bytes }); return json({ error: "expected {data: {metrics: [...]}}" }, 400); }

  const metric = metrics.find((m) => m && m.name === "blood_glucose");
  const samples = metric && Array.isArray(metric.data) ? metric.data : [];

  // Aggregated exports are useless for CGM work. Reject if HAE says so, or if samples carry min/max/avg.
  const agg = [body.aggregation, body.data.aggregation, metric && metric.aggregation].find((a) => a != null);
  const hasMMA = samples.some((s) => s && Object.keys(s).some((k) => /^(min|max|avg)$/i.test(k)));
  const times = samples.map((s) => parseHaeDate(s && s.date)).filter(Boolean).map((d) => d.getTime()).sort((a, b) => a - b);
  const gaps = times.slice(1).map((t, i) => t - times[i]);
  const evenHourOrDay = gaps.length >= 1 && gaps.every((g) => g === gaps[0]) && (gaps[0] === 3600e3 || gaps[0] === 86400e3);
  let reject = null;
  if (agg != null && String(agg).toLowerCase() !== "none") reject = `aggregated export (aggregation=${agg})`;
  else if (hasMMA) reject = evenHourOrDay ? "aggregated export (min/max/avg, samples exactly 1 h or 1 day apart)" : "aggregated export (min/max/avg fields)";
  if (reject) {
    await logIngest(db, { rows_in: samples.length, rejected_reason: reject, payload_bytes: bytes, first_ts: times.length ? new Date(times[0]).toISOString() : null, last_ts: times.length ? new Date(times[times.length - 1]).toISOString() : null });
    return json({ error: "rejected", reason: reject, hint: "Set Aggregation to none in Health Auto Export." }, 422);
  }

  const units = String((metric && metric.units) || "mg/dL");
  const factor = /mmol/i.test(units) ? MMOL_TO_MGDL : 1;
  const rows = [];
  let bad = 0;
  for (const s of samples) {
    const d = parseHaeDate(s && s.date);
    const q = Number(s && s.qty);
    if (!d || !isFinite(q) || q <= 0) { bad++; continue; }
    const app = s.sourceName ?? s.source ?? null;
    rows.push({ ts: d.toISOString(), date: chicagoDate(d), mg: Math.round(q * factor * 10) / 10, source: classify(app), app });
  }

  let rowsNew = 0;
  const stmts = rows.map((r) => db.prepare(
    "INSERT INTO glucose (ts, date, mg_dl, source, source_app) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING RETURNING ts"
  ).bind(r.ts, r.date, r.mg, r.source, r.app));
  for (let i = 0; i < stmts.length; i += 100) {
    const res = await db.batch(stmts.slice(i, i + 100));
    rowsNew += res.reduce((a, x) => a + ((x.results && x.results.length) || 0), 0);
  }
  const sorted = rows.map((r) => r.ts).sort();
  const out = { rows_in: samples.length, rows_new: rowsNew, rows_dup: rows.length - rowsNew };
  await logIngest(db, { ...out, first_ts: sorted[0], last_ts: sorted[sorted.length - 1], payload_bytes: bytes, rejected_reason: bad ? `${bad} sample(s) skipped (bad date or qty)` : null });
  return json(bad ? { ...out, skipped: bad } : out);
}

export async function getIngestLog(db, limit = 20) {
  return (await db.prepare("SELECT * FROM glucose_ingest_log ORDER BY id DESC LIMIT ?").bind(limit).all()).results || [];
}
