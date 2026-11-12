-- Phase 2-4: settings, lift targets, glucose, plan snapshots.

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  note TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Defaults. INSERT OR IGNORE so a re-run never overwrites a value Michael changed.
INSERT OR IGNORE INTO settings (key, value, note) VALUES ('calorie_base', '1900', 'SPEC: weekly 13,300 / 7');
INSERT OR IGNORE INTO settings (key, value, note) VALUES ('calorie_floor', '1700', 'SPEC');
INSERT OR IGNORE INTO settings (key, value, note) VALUES ('calorie_adjust', '0', 'Set by rule 1 in 150-cal steps');
INSERT OR IGNORE INTO settings (key, value, note) VALUES ('calorie_adjust_changed', '', 'Date rule 1 last changed calorie_adjust');
INSERT OR IGNORE INTO settings (key, value, note) VALUES ('protein_target', '230', 'SPEC');
INSERT OR IGNORE INTO settings (key, value, note) VALUES ('step_baseline', '5300', 'SPEC');
INSERT OR IGNORE INTO settings (key, value, note) VALUES ('sodium_cap_default', '2300', 'RESEARCHED: 2025 AHA/ACC BP guideline');
INSERT OR IGNORE INTO settings (key, value, note) VALUES ('sodium_cap_low', '1500', 'RESEARCHED: 2025 AHA/ACC ideal limit');
INSERT OR IGNORE INTO settings (key, value, note) VALUES ('apob_target', '', 'Set from cardiologist, rule 8 off until set');
INSERT OR IGNORE INTO settings (key, value, note) VALUES ('wine_weekly_cap', '', 'Set by Michael after the alcohol report');
INSERT OR IGNORE INTO settings (key, value, note) VALUES ('push_enabled', '1', '6:30 morning push and Sunday push');

CREATE TABLE IF NOT EXISTS lift_targets (
  exercise TEXT PRIMARY KEY,
  rep_low INTEGER NOT NULL,
  rep_high INTEGER NOT NULL,
  increment_lb REAL,
  note TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Seeded from the 11/9-11/11 notes. Inferred, so Michael can change any.
INSERT OR IGNORE INTO lift_targets (exercise, rep_low, rep_high, increment_lb, note) VALUES ('Bench press', 5, 6, 5, 'Notes: 3x6, spec: never below 5');
INSERT OR IGNORE INTO lift_targets (exercise, rep_low, rep_high, increment_lb, note) VALUES ('Incline Hammer press', 8, 12, 5, 'Notes: chase 12s, per side');
INSERT OR IGNORE INTO lift_targets (exercise, rep_low, rep_high, increment_lb, note) VALUES ('Overhead cable extension', 12, 15, 5, 'Notes: chase 15s');
INSERT OR IGNORE INTO lift_targets (exercise, rep_low, rep_high, increment_lb, note) VALUES ('EZ bar skull crusher', 10, 12, 10, 'Notes: next 100');
INSERT OR IGNORE INTO lift_targets (exercise, rep_low, rep_high, increment_lb, note) VALUES ('Rope pushdown', 15, 20, 5, 'Notes: pushdown 50 all sets');
INSERT OR IGNORE INTO lift_targets (exercise, rep_low, rep_high, increment_lb, note) VALUES ('Incline DB curl', 10, 15, 5, 'Notes: incline 30s next');
INSERT OR IGNORE INTO lift_targets (exercise, rep_low, rep_high, increment_lb, note) VALUES ('Straight bar curl', 8, 10, 5, 'Notes: bar 65 all sets');
INSERT OR IGNORE INTO lift_targets (exercise, rep_low, rep_high, increment_lb, note) VALUES ('Hammer curl', 12, 15, 5, 'Notes: hammers 25s all sets');

CREATE TABLE IF NOT EXISTS glucose (
  ts TEXT PRIMARY KEY,              -- ISO timestamp of the reading
  date TEXT NOT NULL,               -- Chicago date
  mg_dl REAL NOT NULL,
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS glucose_date ON glucose(date);

CREATE TABLE IF NOT EXISTS plans (
  date TEXT PRIMARY KEY,
  plan TEXT NOT NULL,               -- JSON from rules.evaluate
  pushed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS rules_log_date ON rules_log(date);

-- Body composition from a smart scale (Withings). Kept apart from InBody scans,
-- which rule 2 uses, because scale BIA is a different, noisier method.
CREATE TABLE IF NOT EXISTS body_comp (
  date TEXT NOT NULL,
  source TEXT NOT NULL,
  weight_lb REAL,
  fat_pct REAL,
  fat_mass_lb REAL,
  lean_mass_lb REAL,
  muscle_mass_lb REAL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (date, source)
);
