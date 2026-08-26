const { Pool } = require("pg");
const { SEED_PROFILE, SEED_BODY_LOG, SEED_DAYS } = require("./seed-data");

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn(
    "[db] WARNING: DATABASE_URL is not set. API routes that touch the database will fail until it's configured. " +
      "See .env.example."
  );
}

const isLocal = connectionString && /localhost|127\.0\.0\.1/.test(connectionString);

const pool = connectionString
  ? new Pool({
      connectionString,
      ssl: isLocal ? false : { rejectUnauthorized: false },
    })
  : null;

function requirePool() {
  if (!pool) {
    const err = new Error("DATABASE_URL ยังไม่ได้ตั้งค่า ดูวิธีตั้งค่าใน README.md");
    err.isConfigError = true;
    throw err;
  }
  return pool;
}

async function query(text, params) {
  return requirePool().query(text, params);
}

// ---- Schema + seed ----
async function migrate() {
  if (!pool) return; // nothing to do without a connection string

  await query(`
    CREATE TABLE IF NOT EXISTS program_days (
      day_key TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT,
      subtitle TEXT
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS program_exercises (
      id TEXT PRIMARY KEY,
      day_key TEXT NOT NULL REFERENCES program_days(day_key) ON DELETE CASCADE,
      name TEXT NOT NULL,
      target TEXT DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS workout_status (
      log_date DATE NOT NULL,
      exercise_id TEXT NOT NULL,
      status TEXT NOT NULL,
      PRIMARY KEY (log_date, exercise_id)
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      gender TEXT NOT NULL,
      height_cm NUMERIC NOT NULL,
      age INTEGER NOT NULL,
      activity_level TEXT NOT NULL,
      goal TEXT NOT NULL
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS body_log (
      id TEXT PRIMARY KEY,
      log_date DATE NOT NULL UNIQUE,
      weight_kg NUMERIC NOT NULL,
      body_fat_pct NUMERIC,
      note TEXT DEFAULT ''
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS nutrition_entries (
      id TEXT PRIMARY KEY,
      log_date DATE NOT NULL,
      food TEXT NOT NULL,
      meal TEXT DEFAULT '',
      calories NUMERIC DEFAULT 0,
      protein NUMERIC DEFAULT 0,
      carbs NUMERIC DEFAULT 0,
      fat NUMERIC DEFAULT 0,
      entry_time TIMESTAMPTZ DEFAULT now()
    );
  `);

  await seedIfEmpty();
}

async function seedIfEmpty() {
  const { rows } = await query("SELECT COUNT(*)::int AS n FROM program_days");
  if (rows[0].n === 0) {
    for (const [dayKey, day] of Object.entries(SEED_DAYS)) {
      await query(
        "INSERT INTO program_days (day_key, label, type, title, subtitle) VALUES ($1,$2,$3,$4,$5)",
        [dayKey, day.label, day.type, day.title, day.subtitle]
      );
      let i = 0;
      for (const ex of day.exercises) {
        i += 1;
        await query(
          "INSERT INTO program_exercises (id, day_key, name, target, sort_order) VALUES ($1,$2,$3,$4,$5)",
          [`${dayKey}-${i}`, dayKey, ex.name, ex.target, i]
        );
      }
    }
    console.log("[db] Seeded program_days / program_exercises");
  }

  const settingsRes = await query("SELECT COUNT(*)::int AS n FROM settings");
  if (settingsRes.rows[0].n === 0) {
    await query(
      "INSERT INTO settings (id, gender, height_cm, age, activity_level, goal) VALUES (1,$1,$2,$3,$4,$5)",
      [SEED_PROFILE.gender, SEED_PROFILE.height_cm, SEED_PROFILE.age, SEED_PROFILE.activity_level, SEED_PROFILE.goal]
    );
    console.log("[db] Seeded settings");
  }

  const bodyLogRes = await query("SELECT COUNT(*)::int AS n FROM body_log");
  if (bodyLogRes.rows[0].n === 0) {
    for (const entry of SEED_BODY_LOG) {
      await query(
        "INSERT INTO body_log (id, log_date, weight_kg, body_fat_pct, note) VALUES ($1,$2,$3,$4,$5)",
        [`seed-${entry.date}`, entry.date, entry.weight_kg, entry.body_fat_pct, entry.note]
      );
    }
    console.log("[db] Seeded body_log");
  }
}

// ---- Program / exercises ----
async function getProgram() {
  const daysRes = await query("SELECT * FROM program_days");
  const exRes = await query("SELECT * FROM program_exercises ORDER BY day_key, sort_order, id");
  const days = {};
  for (const d of daysRes.rows) {
    days[d.day_key] = {
      label: d.label,
      type: d.type,
      title: d.title,
      subtitle: d.subtitle,
      exercises: [],
    };
  }
  for (const e of exRes.rows) {
    if (days[e.day_key]) {
      days[e.day_key].exercises.push({ id: e.id, name: e.name, target: e.target || "" });
    }
  }
  return { days };
}

async function getDay(dayKey) {
  const program = await getProgram();
  return program.days[dayKey];
}

async function addExercise(dayKey, name, target) {
  const day = await getDay(dayKey);
  if (!day) {
    const err = new Error("day not found");
    err.status = 400;
    throw err;
  }
  // Any day (including rest days) can have exercises added — a rest day
  // just starts out empty, it isn't locked to staying empty.
  const maxRes = await query("SELECT COALESCE(MAX(sort_order),0)::int AS m FROM program_exercises WHERE day_key=$1", [dayKey]);
  const nextOrder = maxRes.rows[0].m + 1;
  const id = `${dayKey}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  await query(
    "INSERT INTO program_exercises (id, day_key, name, target, sort_order) VALUES ($1,$2,$3,$4,$5)",
    [id, dayKey, name, target || "", nextOrder]
  );
  return { id, name, target: target || "" };
}

async function updateExercise(dayKey, exerciseId, name, target) {
  const res = await query(
    "UPDATE program_exercises SET name = COALESCE($1, name), target = COALESCE($2, target) WHERE id=$3 AND day_key=$4 RETURNING *",
    [name || null, target !== undefined ? target : null, exerciseId, dayKey]
  );
  if (res.rows.length === 0) {
    const err = new Error("exercise not found");
    err.status = 404;
    throw err;
  }
  const ex = res.rows[0];
  return { id: ex.id, name: ex.name, target: ex.target || "" };
}

async function deleteExercise(dayKey, exerciseId) {
  await query("DELETE FROM program_exercises WHERE id=$1 AND day_key=$2", [exerciseId, dayKey]);
}

// ---- Workout status ----
async function getWorkoutStatus(date) {
  const res = await query("SELECT exercise_id, status FROM workout_status WHERE log_date=$1", [date]);
  const map = {};
  for (const row of res.rows) map[row.exercise_id] = row.status;
  return map;
}

async function setWorkoutStatus(date, exerciseId, status) {
  if (status === "none") {
    await query("DELETE FROM workout_status WHERE log_date=$1 AND exercise_id=$2", [date, exerciseId]);
  } else {
    await query(
      `INSERT INTO workout_status (log_date, exercise_id, status) VALUES ($1,$2,$3)
       ON CONFLICT (log_date, exercise_id) DO UPDATE SET status = EXCLUDED.status`,
      [date, exerciseId, status]
    );
  }
}

async function getWorkoutSummary() {
  const res = await query(`
    SELECT ws.log_date, ws.exercise_id, ws.status, pe.day_key
    FROM workout_status ws
    JOIN program_exercises pe ON pe.id = ws.exercise_id
  `);
  const program = await getProgram();
  const byDate = {};
  for (const row of res.rows) {
    const dateStr = row.log_date.toISOString().slice(0, 10);
    if (!byDate[dateStr]) byDate[dateStr] = { dayKey: row.day_key, statuses: [] };
    byDate[dateStr].statuses.push(row.status);
  }
  const summary = {};
  for (const [dateStr, info] of Object.entries(byDate)) {
    const day = program.days[info.dayKey];
    // Include rest days too — a rest day can have exercises added by the
    // user, and those should still show progress on the week rack.
    if (!day || day.exercises.length === 0) continue;
    const total = day.exercises.length;
    const done = info.statuses.filter((s) => s === "done").length;
    const anyProgress = info.statuses.some((s) => s === "done" || s === "partial");
    summary[dateStr] = { done, total, complete: done === total && total > 0, partial: anyProgress && done !== total };
  }
  return summary;
}

// ---- Settings ----
async function getSettings() {
  const res = await query("SELECT * FROM settings WHERE id=1");
  const s = res.rows[0];
  return {
    gender: s.gender,
    height_cm: Number(s.height_cm),
    age: s.age,
    activity_level: s.activity_level,
    goal: s.goal,
  };
}

async function updateSettings({ gender, height_cm, age, activity_level, goal }) {
  const current = await getSettings();
  const updated = {
    gender: gender || current.gender,
    height_cm: Number(height_cm) || current.height_cm,
    age: Number(age) || current.age,
    activity_level: activity_level || current.activity_level,
    goal: goal || current.goal,
  };
  await query(
    "UPDATE settings SET gender=$1, height_cm=$2, age=$3, activity_level=$4, goal=$5 WHERE id=1",
    [updated.gender, updated.height_cm, updated.age, updated.activity_level, updated.goal]
  );
  return updated;
}

// ---- Body log ----
async function getBodyLog() {
  const res = await query("SELECT * FROM body_log ORDER BY log_date DESC");
  return res.rows.map((r) => ({
    id: r.id,
    date: r.log_date.toISOString().slice(0, 10),
    weight_kg: Number(r.weight_kg),
    body_fat_pct: r.body_fat_pct !== null ? Number(r.body_fat_pct) : null,
    note: r.note || "",
  }));
}

async function getLatestWeight() {
  const res = await query("SELECT * FROM body_log ORDER BY log_date DESC LIMIT 1");
  if (res.rows.length === 0) return null;
  const r = res.rows[0];
  return {
    id: r.id,
    date: r.log_date.toISOString().slice(0, 10),
    weight_kg: Number(r.weight_kg),
    body_fat_pct: r.body_fat_pct !== null ? Number(r.body_fat_pct) : null,
    note: r.note || "",
  };
}

async function upsertBodyEntry({ date, weight_kg, body_fat_pct, note }) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const res = await query(
    `INSERT INTO body_log (id, log_date, weight_kg, body_fat_pct, note) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (log_date) DO UPDATE SET weight_kg = EXCLUDED.weight_kg, body_fat_pct = EXCLUDED.body_fat_pct, note = EXCLUDED.note
     RETURNING *`,
    [id, date, Number(weight_kg), body_fat_pct !== undefined && body_fat_pct !== "" && body_fat_pct !== null ? Number(body_fat_pct) : null, note || ""]
  );
  const r = res.rows[0];
  return {
    id: r.id,
    date: r.log_date.toISOString().slice(0, 10),
    weight_kg: Number(r.weight_kg),
    body_fat_pct: r.body_fat_pct !== null ? Number(r.body_fat_pct) : null,
    note: r.note || "",
  };
}

async function deleteBodyEntry(id) {
  await query("DELETE FROM body_log WHERE id=$1", [id]);
}

// ---- Nutrition ----
async function getNutritionEntries(date) {
  const res = await query("SELECT * FROM nutrition_entries WHERE log_date=$1 ORDER BY entry_time", [date]);
  return res.rows.map((r) => ({
    id: r.id,
    food: r.food,
    meal: r.meal || "",
    calories: Number(r.calories),
    protein: Number(r.protein),
    carbs: Number(r.carbs),
    fat: Number(r.fat),
    time: r.entry_time,
  }));
}

async function addNutritionEntry(date, { food, meal, calories, protein, carbs, fat }) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  await query(
    `INSERT INTO nutrition_entries (id, log_date, food, meal, calories, protein, carbs, fat)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, date, food, meal || "", Number(calories) || 0, Number(protein) || 0, Number(carbs) || 0, Number(fat) || 0]
  );
  return { id, food, meal: meal || "", calories: Number(calories) || 0, protein: Number(protein) || 0, carbs: Number(carbs) || 0, fat: Number(fat) || 0 };
}

async function deleteNutritionEntry(date, id) {
  await query("DELETE FROM nutrition_entries WHERE log_date=$1 AND id=$2", [date, id]);
}

module.exports = {
  pool,
  migrate,
  getProgram,
  getDay,
  addExercise,
  updateExercise,
  deleteExercise,
  getWorkoutStatus,
  setWorkoutStatus,
  getWorkoutSummary,
  getSettings,
  updateSettings,
  getBodyLog,
  getLatestWeight,
  upsertBodyEntry,
  deleteBodyEntry,
  getNutritionEntries,
  addNutritionEntry,
  deleteNutritionEntry,
};
