-- Glucose pipe test (brief 2026-11-13). Extends the existing glucose table instead of
-- rebuilding it: ts = reading_time (UTC ISO), mg_dl = value_mgdl. Nothing dropped or renamed.
ALTER TABLE glucose ADD COLUMN source_app TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS glucose_ts_source ON glucose (ts, source);
CREATE TABLE IF NOT EXISTS glucose_ingest_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  rows_in INTEGER NOT NULL DEFAULT 0,
  rows_new INTEGER NOT NULL DEFAULT 0,
  rows_dup INTEGER NOT NULL DEFAULT 0,
  first_ts TEXT,
  last_ts TEXT,
  rejected_reason TEXT,
  payload_bytes INTEGER
);
