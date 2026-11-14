-- Meal timing for glucose matching (Michael 2026-11-14): eaten_at = when he ate, UTC ISO.
-- Default is the moment of logging. Backfill: logging time, only for rows logged on the day they were eaten
-- (imported Fuel Log history has no meal times and stays NULL).
ALTER TABLE food ADD COLUMN eaten_at TEXT;
UPDATE food SET eaten_at = replace(created_at, ' ', 'T') || 'Z'
  WHERE src_key IS NULL AND date(created_at, '-6 hours') = date;
