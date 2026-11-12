// One-time import. Every row carries a src_key (or natural key) so a re-run
// overwrites instead of duplicating. Returns table counts for the imported source.

export async function importRows(db, { days = [], food = [], lifts = [], labs = [], meds = [], labs_source = null, meds_source = null }) {
  const s = [];
  for (const d of days) {
    s.push(db.prepare(
      `INSERT INTO days (date, weight, water_oz, wine_glasses, sauna_min, steps, cans, note, raw, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?, datetime('now'))
       ON CONFLICT(date) DO UPDATE SET weight=excluded.weight, sauna_min=COALESCE(excluded.sauna_min, days.sauna_min),
         cans=excluded.cans, note=excluded.note, raw=excluded.raw, updated_at=datetime('now')`
    ).bind(d.date, d.weight ?? null, d.water_oz ?? null, d.wine_glasses ?? null, d.sauna_min ?? null, d.steps ?? null,
      d.cans ?? null, d.note ?? null, d.raw ? JSON.stringify(d.raw) : null));
  }
  for (const f of food) {
    s.push(db.prepare(
      `INSERT INTO food (date, meal, name, cal, protein_g, sodium_mg, est, source, src_key) VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(src_key) DO UPDATE SET date=excluded.date, meal=excluded.meal, name=excluded.name, cal=excluded.cal,
         protein_g=excluded.protein_g, sodium_mg=excluded.sodium_mg, est=excluded.est`
    ).bind(f.date, f.meal, f.name, f.cal ?? null, f.protein_g ?? null, f.sodium_mg ?? null, f.est ? 1 : 0, f.source || "fuellog", f.src_key));
  }
  for (const l of lifts) {
    s.push(db.prepare(
      `INSERT INTO lifts (date, exercise, set_no, weight_lb, reps, rpe, note, source, src_key) VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(src_key) DO UPDATE SET date=excluded.date, exercise=excluded.exercise, set_no=excluded.set_no,
         weight_lb=excluded.weight_lb, reps=excluded.reps, rpe=excluded.rpe, note=excluded.note`
    ).bind(l.date, l.exercise, l.set_no, l.weight_lb ?? null, l.reps ?? null, l.rpe ?? null, l.note ?? null, l.source || "fuellog-note", l.src_key));
  }
  for (const x of labs) {
    s.push(db.prepare(
      `INSERT INTO labs (date, panel, test, value, value_text, unit, flag, note, source) VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(date, panel, test) DO UPDATE SET value=excluded.value, value_text=excluded.value_text, unit=excluded.unit,
         flag=excluded.flag, note=excluded.note, source=excluded.source`
    ).bind(x.date, x.panel, x.test, x.value ?? null, x.value_text ?? null, x.unit ?? null, x.flag ?? null, x.note ?? null, x.source ?? labs_source));
  }
  for (const m of meds) {
    s.push(db.prepare(
      `INSERT INTO meds (name, kind, dose, schedule, status, started, stopped, prescriber, note, source) VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(name) DO UPDATE SET kind=excluded.kind, dose=excluded.dose, schedule=excluded.schedule, status=excluded.status,
         started=excluded.started, stopped=excluded.stopped, prescriber=excluded.prescriber, note=excluded.note, source=excluded.source`
    ).bind(m.name, m.kind ?? null, m.dose ?? null, m.schedule ?? null, m.status || "active", m.started ?? null, m.stopped ?? null,
      m.prescriber ?? null, m.note ?? null, m.source ?? meds_source));
  }
  for (let i = 0; i < s.length; i += 100) await db.batch(s.slice(i, i + 100));

  const c = async (sql) => (await db.prepare(sql).first()).n;
  return {
    received: { days: days.length, food: food.length, lifts: lifts.length, labs: labs.length, meds: meds.length },
    in_db: {
      days: await c("SELECT COUNT(*) n FROM days"),
      food_fuellog: await c("SELECT COUNT(*) n FROM food WHERE source='fuellog'"),
      lifts_from_notes: await c("SELECT COUNT(*) n FROM lifts WHERE source='fuellog-note'"),
      labs: await c("SELECT COUNT(*) n FROM labs"),
      meds: await c("SELECT COUNT(*) n FROM meds"),
      fuellog_cal_by_day: (await db.prepare("SELECT date, SUM(cal) cal, SUM(protein_g) p FROM food WHERE source='fuellog' GROUP BY date ORDER BY date").all()).results,
    },
  };
}
