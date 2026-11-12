-- Phase 1 schema. Every statement is idempotent (IF NOT EXISTS) so the worker's
-- self-migration and `wrangler d1 migrations apply` can both run it safely.

CREATE TABLE IF NOT EXISTS days (
  date TEXT PRIMARY KEY,            -- YYYY-MM-DD, America/Chicago
  weight REAL,                      -- lb, morning scale
  water_oz REAL,
  wine_glasses REAL,
  sauna_min REAL,
  steps INTEGER,                    -- manual override, Oura steps live in oura.steps
  cans INTEGER,                     -- sparkling protein cans (old tracker field)
  note TEXT,
  raw TEXT,                         -- original source doc (JSON) when imported
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS food (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  meal TEXT NOT NULL,               -- breakfast|lunch|dinner|snack|shake|other|unspecified
  name TEXT NOT NULL,
  cal REAL,
  protein_g REAL,
  sodium_mg REAL,
  est INTEGER NOT NULL DEFAULT 1,   -- 1 = estimate, 0 = label/measured
  source TEXT NOT NULL DEFAULT 'mcp',
  src_key TEXT UNIQUE,              -- set for imports so re-runs overwrite, never duplicate
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS food_date ON food(date);

CREATE TABLE IF NOT EXISTS lifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  exercise TEXT NOT NULL,
  set_no INTEGER NOT NULL,
  weight_lb REAL,
  reps INTEGER,
  rpe REAL,
  note TEXT,
  source TEXT NOT NULL DEFAULT 'mcp',
  src_key TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS lifts_ex_date ON lifts(exercise, date);

CREATE TABLE IF NOT EXISTS bp (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,                 -- ISO timestamp
  date TEXT NOT NULL,               -- Chicago date of ts
  sys INTEGER NOT NULL,
  dia INTEGER NOT NULL,
  pulse INTEGER,
  note TEXT,
  source TEXT NOT NULL DEFAULT 'mcp',
  src_key TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS bp_date ON bp(date);

CREATE TABLE IF NOT EXISTS oura (
  date TEXT PRIMARY KEY,            -- Oura "day" (the day you woke up)
  sleep_score INTEGER,
  readiness INTEGER,
  hrv INTEGER,                      -- average HRV of the main sleep, ms
  rhr INTEGER,                      -- lowest HR of the main sleep, bpm
  steps INTEGER,
  total_sleep_min INTEGER,
  efficiency INTEGER,
  awake_min INTEGER,
  resp_rate REAL,
  temp_dev REAL,
  active_cal INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cpap (
  date TEXT PRIMARY KEY,            -- myAir startDate = the night the session STARTED
  hours REAL,
  ahi REAL,
  leak REAL,                        -- 95th percentile leak, L/min
  mask_off INTEGER,                 -- mask on/off pairs
  myair_score INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scans (
  date TEXT PRIMARY KEY,
  weight REAL, smm REAL, bfm REAL, pbf REAL, lean_mass REAL,
  trunk_fat REAL, visceral REAL,
  raw TEXT
);

CREATE TABLE IF NOT EXISTS labs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,               -- YYYY-MM-DD (YYYY-MM when the source gives only a month)
  panel TEXT NOT NULL,
  test TEXT NOT NULL,
  value REAL,
  value_text TEXT,                  -- for "<3.0", ">60", or narrative results
  unit TEXT,
  flag TEXT,                        -- H / L as reported by the lab
  note TEXT,
  source TEXT,
  UNIQUE(date, panel, test)
);

CREATE TABLE IF NOT EXISTS meds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  kind TEXT,                        -- rx | otc | supplement
  dose TEXT,
  schedule TEXT,
  status TEXT NOT NULL DEFAULT 'active',  -- active | stopped
  started TEXT,
  stopped TEXT,
  prescriber TEXT,
  note TEXT,
  source TEXT
);

CREATE TABLE IF NOT EXISTS eye (
  date TEXT PRIMARY KEY,
  injection INTEGER,
  drug TEXT,
  interval_weeks REAL,
  oct_thickness REAL,
  note TEXT
);

CREATE TABLE IF NOT EXISTS rules_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  rule TEXT NOT NULL,
  input TEXT,
  output TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  trigger TEXT NOT NULL,            -- cron | sync_now
  source TEXT NOT NULL,             -- oura | cpap
  ok INTEGER NOT NULL,
  rows INTEGER,
  detail TEXT
);
