-- 1.4 daily_features: one row per date that has any data.
-- cpap_hours/ahi = the CPAP night that ENDED the morning of `date` (night dated date-1).
-- BP am/pm split uses local hour: UTC-5 for Apr-Oct, UTC-6 otherwise (approximation of
-- US Central DST, only wrong for readings within an hour of noon in early Mar / early Nov).
DROP VIEW IF EXISTS daily_features;
CREATE VIEW daily_features AS
WITH sa AS (SELECT date FROM days UNION SELECT date FROM food UNION SELECT date FROM oura),
sb AS (SELECT date(date, '+1 day') date FROM cpap UNION SELECT date FROM bp UNION SELECT date FROM lifts),
spine AS (SELECT date FROM sa UNION SELECT date FROM sb),
f AS (
  SELECT date, COUNT(*) n, SUM(cal) cal, SUM(protein_g) protein_g, SUM(sodium_mg) sodium_mg,
    SUM(sodium_mg IS NULL) sodium_missing,
    COUNT(DISTINCT CASE WHEN restaurant=1 THEN (CASE WHEN meal IN ('breakfast','lunch','dinner') THEN meal ELSE 'item' || id END) END) restaurant_meals
  FROM food GROUP BY date
),
b AS (
  SELECT date,
    CASE WHEN CAST(strftime('%m', date) AS INTEGER) BETWEEN 4 AND 10 THEN CAST(strftime('%H', ts, '-5 hours') AS INTEGER)
         ELSE CAST(strftime('%H', ts, '-6 hours') AS INTEGER) END lh,
    sys, dia
  FROM bp
),
bp2 AS (
  SELECT date,
    ROUND(AVG(CASE WHEN lh < 12 THEN sys END)) bp_sys_am, ROUND(AVG(CASE WHEN lh < 12 THEN dia END)) bp_dia_am,
    ROUND(AVG(CASE WHEN lh >= 12 THEN sys END)) bp_sys_pm, ROUND(AVG(CASE WHEN lh >= 12 THEN dia END)) bp_dia_pm
  FROM b GROUP BY date
),
l AS (SELECT date, COUNT(*) sets FROM lifts GROUP BY date)
SELECT
  s.date AS date,
  d.weight AS weight,
  ROUND(f.cal, 1) AS cal,
  ROUND(f.protein_g, 1) AS protein_g,
  ROUND(f.sodium_mg) AS sodium_mg,
  COALESCE(f.restaurant_meals, 0) AS restaurant_meals,
  d.wine_glasses AS wine_glasses,
  d.caffeine_mg AS caffeine_mg,
  d.caffeine_last_time AS caffeine_last_time,
  d.last_meal_time AS last_meal_time,
  COALESCE(d.steps, o.steps) AS steps,
  o.total_sleep_min AS total_sleep_min,
  o.sleep_score AS sleep_score,
  o.hrv AS hrv,
  o.rhr AS rhr,
  o.readiness AS readiness,
  c.hours AS cpap_hours,
  c.ahi AS ahi,
  bp2.bp_sys_am AS bp_sys_am, bp2.bp_dia_am AS bp_dia_am,
  bp2.bp_sys_pm AS bp_sys_pm, bp2.bp_dia_pm AS bp_dia_pm,
  COALESCE(l.sets, 0) AS lift_sets,
  d.sauna_min AS sauna_min,
  d.water_oz AS water_oz,
  o.vo2_max AS vo2_max,
  o.cardio_age AS cardio_age,
  d.waist_in AS waist_in,
  CASE CAST(strftime('%w', s.date) AS INTEGER) WHEN 0 THEN 'Sun' WHEN 1 THEN 'Mon' WHEN 2 THEN 'Tue' WHEN 3 THEN 'Wed' WHEN 4 THEN 'Thu' WHEN 5 THEN 'Fri' ELSE 'Sat' END AS day_of_week,
  CASE WHEN COALESCE(f.n, 0) > 0 THEN 1 ELSE 0 END AS food_logged,
  CASE WHEN d.weight IS NOT NULL THEN 1 ELSE 0 END AS weight_logged,
  COALESCE(f.sodium_missing, 0) AS sodium_missing_items
FROM spine s
LEFT JOIN days d ON d.date = s.date
LEFT JOIN f ON f.date = s.date
LEFT JOIN oura o ON o.date = s.date
LEFT JOIN cpap c ON c.date = date(s.date, '-1 day')
LEFT JOIN bp2 ON bp2.date = s.date
LEFT JOIN l ON l.date = s.date;
