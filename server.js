require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, "data");
const PROGRAM_FILE = path.join(DATA_DIR, "program.json");
const WORKOUT_LOG_FILE = path.join(DATA_DIR, "workout-log.json");
const NUTRITION_LOG_FILE = path.join(DATA_DIR, "nutrition-log.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const BODY_LOG_FILE = path.join(DATA_DIR, "body-log.json");

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    return fallback;
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

// Make sure the log files exist
if (!fs.existsSync(WORKOUT_LOG_FILE)) writeJSON(WORKOUT_LOG_FILE, {});
if (!fs.existsSync(NUTRITION_LOG_FILE)) writeJSON(NUTRITION_LOG_FILE, {});
if (!fs.existsSync(SETTINGS_FILE)) {
  writeJSON(SETTINGS_FILE, { gender: "ชาย", height_cm: 170, age: 30, activity_level: "light", goal: "fatloss" });
}
if (!fs.existsSync(BODY_LOG_FILE)) writeJSON(BODY_LOG_FILE, []);

const DOW_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function dayKeyForDate(dateStr) {
  // dateStr = "YYYY-MM-DD" -> local date, avoid TZ shift by parsing manually
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return DOW_KEYS[dt.getDay()];
}

// ---- Nutrition auto-calculation (Mifflin-St Jeor) ----
const ACTIVITY_LEVELS = {
  sedentary: { label: "นั่งทำงานเป็นหลัก ไม่ค่อยได้ออกกำลังกาย", mult: 1.2 },
  light: { label: "นั่งทำงานเป็นหลัก + ออกกำลังกาย 3-4 วัน/สัปดาห์", mult: 1.3 },
  moderate: { label: "ออกกำลังกายสม่ำเสมอ 4-5 วัน/สัปดาห์", mult: 1.45 },
  active: { label: "ออกกำลังกายหนัก 6-7 วัน/สัปดาห์", mult: 1.6 },
  very_active: { label: "ใช้แรงงานหนัก หรือเป็นนักกีฬา", mult: 1.75 },
};

const GOALS = {
  fatloss: { label: "ลดไขมัน", calAdjust: -425 },
  maintain: { label: "รักษาน้ำหนัก / สร้างสุขภาพ", calAdjust: 0 },
  gain: { label: "เพิ่มกล้ามเนื้อ", calAdjust: 300 },
};

function getLatestWeight() {
  const log = readJSON(BODY_LOG_FILE, []);
  if (log.length === 0) return null;
  const sorted = [...log].sort((a, b) => (a.date < b.date ? 1 : -1));
  return sorted[0];
}

function calcNutrition(settings, weightKg) {
  const { gender, height_cm, age } = settings;
  const bmr =
    gender === "หญิง"
      ? 10 * weightKg + 6.25 * height_cm - 5 * age - 161
      : 10 * weightKg + 6.25 * height_cm - 5 * age + 5;
  const activity = ACTIVITY_LEVELS[settings.activity_level] || ACTIVITY_LEVELS.light;
  const tdee = bmr * activity.mult;
  const goal = GOALS[settings.goal] || GOALS.fatloss;
  const targetCalories = Math.max(1200, tdee + goal.calAdjust);
  const proteinG = Math.round(weightKg * 1.9);
  const fatG = Math.round((targetCalories * 0.25) / 9);
  const carbsG = Math.max(0, Math.round((targetCalories - proteinG * 4 - fatG * 9) / 4));
  return {
    weight_kg: weightKg,
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    target_calories: Math.round(targetCalories),
    protein_g: proteinG,
    carbs_g: carbsG,
    fat_g: fatG,
    activity_label: activity.label,
    goal_label: goal.label,
  };
}

function getComputedNutrition() {
  const settings = readJSON(SETTINGS_FILE, {});
  const latest = getLatestWeight();
  const weightKg = latest ? latest.weight_kg : 70;
  return { computed: calcNutrition(settings, weightKg), latestWeight: latest, settings };
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---- Program info ----
app.get("/api/program", (req, res) => {
  res.json(readJSON(PROGRAM_FILE, {}));
});

// ---- Workout checklist ----
app.get("/api/workout/:date", (req, res) => {
  const { date } = req.params;
  const program = readJSON(PROGRAM_FILE, {});
  const dayKey = dayKeyForDate(date);
  const day = program.days[dayKey];
  const log = readJSON(WORKOUT_LOG_FILE, {});
  const completed = log[date] || {};
  res.json({ date, dayKey, day, completed });
});

const VALID_STATUSES = ["none", "partial", "done"];

app.post("/api/workout/:date/status", (req, res) => {
  const { date } = req.params;
  const { exerciseId, status } = req.body;
  if (!exerciseId) return res.status(400).json({ error: "exerciseId required" });
  if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: "invalid status" });
  const log = readJSON(WORKOUT_LOG_FILE, {});
  if (!log[date]) log[date] = {};
  if (status === "none") delete log[date][exerciseId];
  else log[date][exerciseId] = status;
  writeJSON(WORKOUT_LOG_FILE, log);
  res.json({ ok: true, date, exerciseId, status });
});

// weekly overview (for streak / dashboard summary)
app.get("/api/workout-summary", (req, res) => {
  const program = readJSON(PROGRAM_FILE, {});
  const log = readJSON(WORKOUT_LOG_FILE, {});
  const summary = {};
  for (const date of Object.keys(log)) {
    const dayKey = dayKeyForDate(date);
    const day = program.days[dayKey];
    if (!day || day.type !== "gym") continue;
    const total = day.exercises.length;
    const statuses = Object.values(log[date]);
    const done = statuses.filter((s) => s === "done").length;
    const anyProgress = statuses.some((s) => s === "done" || s === "partial");
    summary[date] = { done, total, complete: done === total && total > 0, partial: anyProgress && done !== total };
  }
  res.json(summary);
});

// ---- Exercise management (add / edit / delete per day) ----
app.post("/api/program/:dayKey/exercises", (req, res) => {
  const { dayKey } = req.params;
  const { name, target } = req.body;
  if (!name) return res.status(400).json({ error: "name required" });
  const program = readJSON(PROGRAM_FILE, {});
  const day = program.days[dayKey];
  if (!day || day.type !== "gym") return res.status(400).json({ error: "invalid or non-gym day" });
  const id = `${dayKey}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const exercise = { id, name, target: target || "" };
  day.exercises.push(exercise);
  writeJSON(PROGRAM_FILE, program);
  res.json({ ok: true, exercise });
});

app.put("/api/program/:dayKey/exercises/:exerciseId", (req, res) => {
  const { dayKey, exerciseId } = req.params;
  const { name, target } = req.body;
  const program = readJSON(PROGRAM_FILE, {});
  const day = program.days[dayKey];
  if (!day || day.type !== "gym") return res.status(400).json({ error: "invalid or non-gym day" });
  const ex = day.exercises.find((e) => e.id === exerciseId);
  if (!ex) return res.status(404).json({ error: "exercise not found" });
  if (name) ex.name = name;
  if (target !== undefined) ex.target = target;
  writeJSON(PROGRAM_FILE, program);
  res.json({ ok: true, exercise: ex });
});

app.delete("/api/program/:dayKey/exercises/:exerciseId", (req, res) => {
  const { dayKey, exerciseId } = req.params;
  const program = readJSON(PROGRAM_FILE, {});
  const day = program.days[dayKey];
  if (!day || day.type !== "gym") return res.status(400).json({ error: "invalid or non-gym day" });
  day.exercises = day.exercises.filter((e) => e.id !== exerciseId);
  writeJSON(PROGRAM_FILE, program);
  res.json({ ok: true });
});



// ---- Nutrition log ----
app.get("/api/nutrition/:date", (req, res) => {
  const { date } = req.params;
  const log = readJSON(NUTRITION_LOG_FILE, {});
  const entries = log[date] || [];
  const totals = entries.reduce(
    (acc, e) => ({
      calories: acc.calories + (Number(e.calories) || 0),
      protein: acc.protein + (Number(e.protein) || 0),
      carbs: acc.carbs + (Number(e.carbs) || 0),
      fat: acc.fat + (Number(e.fat) || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
  const { computed } = getComputedNutrition();
  res.json({ date, entries, totals, targets: computed });
});

app.post("/api/nutrition/:date", (req, res) => {
  const { date } = req.params;
  const { food, meal, calories, protein, carbs, fat } = req.body;
  if (!food) return res.status(400).json({ error: "food required" });
  const log = readJSON(NUTRITION_LOG_FILE, {});
  if (!log[date]) log[date] = [];
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    food,
    meal: meal || "",
    calories: Number(calories) || 0,
    protein: Number(protein) || 0,
    carbs: Number(carbs) || 0,
    fat: Number(fat) || 0,
    time: new Date().toISOString(),
  };
  log[date].push(entry);
  writeJSON(NUTRITION_LOG_FILE, log);
  res.json({ ok: true, entry });
});

// ---- Profile settings (for auto nutrition calculation) ----
app.get("/api/settings", (req, res) => {
  const { computed, latestWeight, settings } = getComputedNutrition();
  res.json({
    settings,
    latestWeight,
    computed,
    activityLevels: Object.entries(ACTIVITY_LEVELS).map(([id, v]) => ({ id, label: v.label })),
    goals: Object.entries(GOALS).map(([id, v]) => ({ id, label: v.label })),
  });
});

app.put("/api/settings", (req, res) => {
  const { gender, height_cm, age, activity_level, goal } = req.body;
  const current = readJSON(SETTINGS_FILE, {});
  const updated = {
    gender: gender || current.gender,
    height_cm: Number(height_cm) || current.height_cm,
    age: Number(age) || current.age,
    activity_level: ACTIVITY_LEVELS[activity_level] ? activity_level : current.activity_level,
    goal: GOALS[goal] ? goal : current.goal,
  };
  writeJSON(SETTINGS_FILE, updated);
  const { computed, latestWeight } = getComputedNutrition();
  res.json({ ok: true, settings: updated, computed, latestWeight });
});

// ---- Body log (weight / body fat over time) ----
app.get("/api/body-log", (req, res) => {
  const log = readJSON(BODY_LOG_FILE, []);
  const sorted = [...log].sort((a, b) => (a.date < b.date ? 1 : -1));
  res.json({ entries: sorted });
});

app.post("/api/body-log", (req, res) => {
  const { date, weight_kg, body_fat_pct, note } = req.body;
  if (!date || !weight_kg) return res.status(400).json({ error: "date and weight_kg required" });
  const log = readJSON(BODY_LOG_FILE, []);
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    date,
    weight_kg: Number(weight_kg),
    body_fat_pct: body_fat_pct !== undefined && body_fat_pct !== "" ? Number(body_fat_pct) : null,
    note: note || "",
  };
  // replace existing entry for the same date if present, else add
  const idx = log.findIndex((e) => e.date === date);
  if (idx >= 0) log[idx] = entry;
  else log.push(entry);
  writeJSON(BODY_LOG_FILE, log);
  const { computed, latestWeight } = getComputedNutrition();
  res.json({ ok: true, entry, computed, latestWeight });
});

app.delete("/api/body-log/:id", (req, res) => {
  const { id } = req.params;
  const log = readJSON(BODY_LOG_FILE, []);
  writeJSON(BODY_LOG_FILE, log.filter((e) => e.id !== id));
  const { computed, latestWeight } = getComputedNutrition();
  res.json({ ok: true, computed, latestWeight });
});


app.delete("/api/nutrition/:date/:entryId", (req, res) => {
  const { date, entryId } = req.params;
  const log = readJSON(NUTRITION_LOG_FILE, {});
  if (!log[date]) return res.json({ ok: true });
  log[date] = log[date].filter((e) => e.id !== entryId);
  writeJSON(NUTRITION_LOG_FILE, log);
  res.json({ ok: true });
});

// ---- Exercise chat assistant ----
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CHAT_MODEL = "claude-sonnet-5";

app.post("/api/chat", async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: "ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY บนเซิร์ฟเวอร์ ดูวิธีตั้งค่าใน README.md",
    });
  }

  const { date, messages } = req.body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages required" });
  }

  const program = readJSON(PROGRAM_FILE, {});
  const dayKey = dayKeyForDate(date || todayKeyFallback());
  const day = program.days[dayKey];
  const profile = program.profile;

  const dayContext =
    day && day.type === "gym"
      ? `วันนี้ (${day.label}) เป็นวัน "${day.title}" (${day.subtitle}) ท่าที่อยู่ในโปรแกรมตอนนี้คือ:\n` +
        day.exercises.map((ex) => `- ${ex.name} (${ex.target})`).join("\n")
      : `วันนี้ (${day ? day.label : "-"}) เป็นวันพัก ไม่มีท่าออกกำลังกายในโปรแกรม`;

  const systemPrompt = `คุณเป็นผู้ช่วยเทรนเนอร์ส่วนตัวในแอปติดตามการออกกำลังกาย ตอบเป็นภาษาไทย กระชับ ชัดเจน และปลอดภัย

ข้อมูลผู้ใช้: เพศ${profile.gender} อายุ ${profile.age} ปี น้ำหนัก ${profile.weight_kg} กก. ส่วนสูง ${profile.height_cm} ซม.
เป้าหมาย: ${profile.goal}
กิจกรรม: ${profile.activity}

${dayContext}

หน้าที่ของคุณ: ช่วยแนะนำท่าออกกำลังกายทดแทน หรือปรับท่าในโปรแกรม เมื่อผู้ใช้ถามเรื่องเปลี่ยนท่า (เช่น ไม่มีอุปกรณ์, บาดเจ็บ, ท่าเดิมทำไม่ถนัด, อยากเพิ่มความหลากหลาย)
แนวทางการตอบ:
- แนะนำท่าที่ทำงานกล้ามเนื้อกลุ่มเดียวกันกับท่าเดิมเป็นหลัก เพื่อให้โปรแกรมยังคงสมดุล
- ถ้าผู้ใช้บอกว่าเจ็บหรือบาดเจ็บ ให้เตือนอย่างสุภาพว่าควรปรึกษาแพทย์หรือนักกายภาพบำบัดก่อน ไม่วินิจฉัยอาการเอง และแนะนำท่าที่เลี่ยงบริเวณที่บาดเจ็บ
- ถามคำถามตอบกลับสั้นๆ ได้ถ้าข้อมูลไม่พอ เช่น ถามว่ามีอุปกรณ์อะไรบ้าง
- ให้จำนวนเซ็ต/reps แนะนำประกอบด้วยเมื่อเหมาะสม
- ตอบสั้น กระชับ ไม่ต้องยาวเกินจำเป็น`;

  try {
    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CHAT_MODEL,
        max_tokens: 700,
        system: systemPrompt,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      console.error("Anthropic API error:", apiRes.status, errText);
      return res.status(502).json({ error: "เรียก API ไม่สำเร็จ ลองใหม่อีกครั้ง" });
    }

    const data = await apiRes.json();
    const textBlock = (data.content || []).find((b) => b.type === "text");
    res.json({ reply: textBlock ? textBlock.text : "" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "เกิดข้อผิดพลาดในการเชื่อมต่อ" });
  }
});

function todayKeyFallback() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

app.listen(PORT, () => {
  console.log(`Fitness tracker running on http://localhost:${PORT}`);
});
