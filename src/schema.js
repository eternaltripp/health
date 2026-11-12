// Self-applying migrations. Workers Builds only runs `wrangler deploy`, so the
// worker brings its own schema up to date on first use. Applied migrations are
// recorded in wrangler's own d1_migrations table, so `wrangler d1 migrations
// apply` stays in sync and will skip them.
import m0001 from "../migrations/0001_init.sql";
import m0002 from "../migrations/0002_phase2.sql";
import m0003 from "../migrations/0003_brief_2026_11_12.sql";
import m0004 from "../migrations/0004_sodium_backfill.sql";
import m0005 from "../migrations/0005_daily_features.sql";
import m0006 from "../migrations/0006_clear_offcycle_target.sql";
import m0007 from "../migrations/0007_push_note.sql";
import m0008 from "../migrations/0008_goal_weight.sql";
import m0009 from "../migrations/0009_clear_bad_burn.sql";

// Statements are split on ";" so no string literal in a migration may contain one.
const MIGRATIONS = [["0001_init.sql", m0001], ["0002_phase2.sql", m0002], ["0003_brief_2026_11_12.sql", m0003], ["0004_sodium_backfill.sql", m0004], ["0005_daily_features.sql", m0005], ["0006_clear_offcycle_target.sql", m0006], ["0007_push_note.sql", m0007], ["0008_goal_weight.sql", m0008], ["0009_clear_bad_burn.sql", m0009]];

let ready = null; // per-isolate memo

export function ensureSchema(db) {
  if (!ready) ready = apply(db).catch((e) => { ready = null; throw e; });
  return ready;
}

// Strip comments first (so a ";" inside a comment can't split a statement), then split.
function statements(sql) {
  return sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function apply(db) {
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)"
  ).run();
  const done = new Set(((await db.prepare("SELECT name FROM d1_migrations").all()).results || []).map((r) => r.name));
  for (const [name, sql] of MIGRATIONS) {
    if (done.has(name)) continue;
    const stmts = statements(sql).map((s) => db.prepare(s));
    stmts.push(db.prepare("INSERT OR IGNORE INTO d1_migrations (name) VALUES (?)").bind(name));
    await db.batch(stmts); // batch = one transaction
  }
}
