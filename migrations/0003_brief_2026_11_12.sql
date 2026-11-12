-- Build brief 2026-11-12. No semicolons inside string literals (the splitter cuts on them).

-- 1.2 / 4.3 new daily fields
ALTER TABLE days ADD COLUMN caffeine_last_time TEXT;
ALTER TABLE days ADD COLUMN caffeine_mg REAL;
ALTER TABLE days ADD COLUMN last_meal_time TEXT;
ALTER TABLE days ADD COLUMN waist_in REAL;

-- 1.2 restaurant flag on food
ALTER TABLE food ADD COLUMN restaurant INTEGER NOT NULL DEFAULT 0;

-- 1.7 Oura VO2 max and cardiovascular age
ALTER TABLE oura ADD COLUMN vo2_max REAL;
ALTER TABLE oura ADD COLUMN cardio_age INTEGER;

-- 5.1 model outputs (one row per date and model)
CREATE TABLE IF NOT EXISTS model_outputs (
  date TEXT NOT NULL,
  model TEXT NOT NULL,
  value REAL,
  inputs TEXT,
  version TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (date, model)
);

-- 2.4 saved meals
CREATE TABLE IF NOT EXISTS saved_meals (
  name TEXT PRIMARY KEY,
  meal TEXT,
  items TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 4.2 capacity tests
CREATE TABLE IF NOT EXISTS capacity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  test TEXT NOT NULL,
  value REAL NOT NULL,
  unit TEXT,
  note TEXT,
  source TEXT DEFAULT 'mcp',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS capacity_test_date ON capacity (test, date);

-- 3.x one row per (date, push kind) so afternoon pushes never repeat
CREATE TABLE IF NOT EXISTS push_log (
  date TEXT NOT NULL,
  kind TEXT NOT NULL,
  sent_at TEXT DEFAULT (datetime('now')),
  text TEXT,
  PRIMARY KEY (date, kind)
);

-- 3.4 push toggles
INSERT OR IGNORE INTO settings (key, value, note) VALUES ('push_friday_enabled', '1', 'Friday 3:00 pm weekend-plan push')
;
INSERT OR IGNORE INTO settings (key, value, note) VALUES ('push_dinner_prompt_enabled', '1', 'Weekday 3:30 pm dinner-out prompt')
;

-- 1.8 meds
UPDATE meds SET status='stopped', note=COALESCE(note || ' / ', '') || 'Stopped (per Michael, brief 2026-11-12)' WHERE name='Glycine';
UPDATE meds SET name='Magnesium glycinate', note=COALESCE(note || ' / ', '') || 'Was logged as gluconate, corrected 2026-11-12' WHERE name='Magnesium gluconate';
UPDATE meds SET note=COALESCE(note || ' / ', '') || 'Chart says 1 g twice daily, app says 1 g. Dose unconfirmed, ask Michael.' WHERE name LIKE '%Lovaza%';
UPDATE meds SET status='stopped' WHERE name LIKE 'TMG%';

-- 4.2 seed: push-ups to failure 15 on 2026-11-09 (from that day's note)
INSERT INTO capacity (date, test, value, unit, note, source) VALUES ('2026-11-09', 'pushups', 15, 'reps', 'From the 11-09 day note', 'fuellog-note');

-- 1.1 sodium backfill. Cans: 95 mg each, Genius Gourmet label (RESEARCHED, Open Food Facts).
UPDATE food SET sodium_mg = 95 * CAST(TRIM(SUBSTR(name, INSTR(name, ' x') + 2)) AS INTEGER)
  WHERE src_key LIKE 'fuellog:%:cans' AND sodium_mg IS NULL AND name LIKE 'Sparkling protein can x%';

-- 1.1 restaurant flag for imported history
UPDATE food SET restaurant=1 WHERE src_key IN (
  'fuellog:2026-10-27:item:0',
  'fuellog:2026-10-28:item:0', 'fuellog:2026-10-28:item:1', 'fuellog:2026-10-28:preset:d',
  'fuellog:2026-10-29:preset:d',
  'fuellog:2026-10-31:item:0', 'fuellog:2026-10-31:item:1', 'fuellog:2026-10-31:preset:l',
  'fuellog:2026-11-01:item:0', 'fuellog:2026-11-01:item:1', 'fuellog:2026-11-01:item:2',
  'fuellog:2026-11-03:item:1',
  'fuellog:2026-11-08:item:0', 'fuellog:2026-11-08:item:1', 'fuellog:2026-11-08:item:2',
  'fuellog:2026-11-10:item:3', 'fuellog:2026-11-10:item:4',
  'fuellog:2026-11-11:item:0', 'fuellog:2026-11-11:item:1'
);
