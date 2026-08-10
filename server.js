require("dotenv").config();
const express = require("express");
const path = require("path");
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

const DOW_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function dayKeyForDate(dateStr) {
  // dateStr = "YYYY-MM-DD" -> local date, avoid TZ shift by parsing manually
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return DOW_KEYS[dt.getDay()];
}

function todayStrFallback() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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

async function getComputedNutrition() {
  const settings = await db.getSettings();
  const latest = await db.getLatestWeight();
  const weightKg = latest ? latest.weight_kg : 70;
  return { computed: calcNutrition(settings, weightKg), latestWeight: latest, settings };
}

// Wrap async route handlers so thrown errors reach a JSON error response
// instead of crashing the process or hanging the request.
function h(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      console.error(e);
      const status = e.status || (e.isConfigError ? 500 : 500);
      res.status(status).json({ error: e.isConfigError ? e.message : "เกิดข้อผิดพลาดที่เซิร์ฟเวอร์ ลองใหม่อีกครั้ง" });
    }
  };
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---- Program info ----
app.get("/api/program", h(async (req, res) => {
  res.json(await db.getProgram());
}));

// ---- Workout checklist ----
app.get("/api/workout/:date", h(async (req, res) => {
  const { date } = req.params;
  const dayKey = dayKeyForDate(date);
  const day = await db.getDay(dayKey);
  const completed = await db.getWorkoutStatus(date);
  res.json({ date, dayKey, day, completed });
}));

const VALID_STATUSES = ["none", "partial", "done"];

app.post("/api/workout/:date/status", h(async (req, res) => {
  const { date } = req.params;
  const { exerciseId, status } = req.body;
  if (!exerciseId) return res.status(400).json({ error: "exerciseId required" });
  if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: "invalid status" });
  await db.setWorkoutStatus(date, exerciseId, status);
  res.json({ ok: true, date, exerciseId, status });
}));

app.get("/api/workout-summary", h(async (req, res) => {
  res.json(await db.getWorkoutSummary());
}));

// ---- Exercise management (add / edit / delete per day) ----
app.post("/api/program/:dayKey/exercises", h(async (req, res) => {
  const { dayKey } = req.params;
  const { name, target } = req.body;
  if (!name) return res.status(400).json({ error: "name required" });
  const exercise = await db.addExercise(dayKey, name, target);
  res.json({ ok: true, exercise });
}));

app.put("/api/program/:dayKey/exercises/:exerciseId", h(async (req, res) => {
  const { dayKey, exerciseId } = req.params;
  const { name, target } = req.body;
  const exercise = await db.updateExercise(dayKey, exerciseId, name, target);
  res.json({ ok: true, exercise });
}));

app.delete("/api/program/:dayKey/exercises/:exerciseId", h(async (req, res) => {
  const { dayKey, exerciseId } = req.params;
  await db.deleteExercise(dayKey, exerciseId);
  res.json({ ok: true });
}));

// ---- Nutrition log ----
app.get("/api/nutrition/:date", h(async (req, res) => {
  const { date } = req.params;
  const entries = await db.getNutritionEntries(date);
  const totals = entries.reduce(
    (acc, e) => ({
      calories: acc.calories + e.calories,
      protein: acc.protein + e.protein,
      carbs: acc.carbs + e.carbs,
      fat: acc.fat + e.fat,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
  const { computed } = await getComputedNutrition();
  res.json({ date, entries, totals, targets: computed });
}));

app.post("/api/nutrition/:date", h(async (req, res) => {
  const { date } = req.params;
  const { food, meal, calories, protein, carbs, fat } = req.body;
  if (!food) return res.status(400).json({ error: "food required" });
  const entry = await db.addNutritionEntry(date, { food, meal, calories, protein, carbs, fat });
  res.json({ ok: true, entry });
}));

app.delete("/api/nutrition/:date/:entryId", h(async (req, res) => {
  const { date, entryId } = req.params;
  await db.deleteNutritionEntry(date, entryId);
  res.json({ ok: true });
}));

// ---- Profile settings (for auto nutrition calculation) ----
app.get("/api/settings", h(async (req, res) => {
  const { computed, latestWeight, settings } = await getComputedNutrition();
  res.json({
    settings,
    latestWeight,
    computed,
    activityLevels: Object.entries(ACTIVITY_LEVELS).map(([id, v]) => ({ id, label: v.label })),
    goals: Object.entries(GOALS).map(([id, v]) => ({ id, label: v.label })),
  });
}));

app.put("/api/settings", h(async (req, res) => {
  const { gender, height_cm, age, activity_level, goal } = req.body;
  const updated = await db.updateSettings({
    gender,
    height_cm,
    age,
    activity_level: ACTIVITY_LEVELS[activity_level] ? activity_level : undefined,
    goal: GOALS[goal] ? goal : undefined,
  });
  const { computed, latestWeight } = await getComputedNutrition();
  res.json({ ok: true, settings: updated, computed, latestWeight });
}));

// ---- Body log (weight / body fat over time) ----
app.get("/api/body-log", h(async (req, res) => {
  res.json({ entries: await db.getBodyLog() });
}));

app.post("/api/body-log", h(async (req, res) => {
  const { date, weight_kg, body_fat_pct, note } = req.body;
  if (!date || !weight_kg) return res.status(400).json({ error: "date and weight_kg required" });
  const entry = await db.upsertBodyEntry({ date, weight_kg, body_fat_pct, note });
  const { computed, latestWeight } = await getComputedNutrition();
  res.json({ ok: true, entry, computed, latestWeight });
}));

app.delete("/api/body-log/:id", h(async (req, res) => {
  await db.deleteBodyEntry(req.params.id);
  const { computed, latestWeight } = await getComputedNutrition();
  res.json({ ok: true, computed, latestWeight });
}));

// ---- Exercise chat assistant ----
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CHAT_MODEL = "claude-sonnet-5";

app.post("/api/chat", h(async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: "ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY บนเซิร์ฟเวอร์ ดูวิธีตั้งค่าใน README.md",
    });
  }

  const { date, messages } = req.body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages required" });
  }

  const dayKey = dayKeyForDate(date || todayStrFallback());
  const day = await db.getDay(dayKey);
  const { computed, settings } = await getComputedNutrition();

  const dayContext =
    day && day.type === "gym"
      ? `วันนี้ (${day.label}) เป็นวัน "${day.title}" (${day.subtitle}) ท่าที่อยู่ในโปรแกรมตอนนี้คือ:\n` +
        day.exercises.map((ex) => `- ${ex.name} (${ex.target})`).join("\n")
      : `วันนี้ (${day ? day.label : "-"}) เป็นวันพัก ไม่มีท่าออกกำลังกายในโปรแกรม`;

  const systemPrompt = `คุณเป็นผู้ช่วยเทรนเนอร์ส่วนตัวในแอปติดตามการออกกำลังกาย ตอบเป็นภาษาไทย กระชับ ชัดเจน และปลอดภัย

ข้อมูลผู้ใช้: เพศ${settings.gender} อายุ ${settings.age} ปี น้ำหนัก ${computed.weight_kg} กก. ส่วนสูง ${settings.height_cm} ซม.
เป้าหมาย: ${computed.goal_label}

${dayContext}

หน้าที่ของคุณ: ช่วยแนะนำท่าออกกำลังกายทดแทน หรือปรับท่าในโปรแกรม เมื่อผู้ใช้ถามเรื่องเปลี่ยนท่า (เช่น ไม่มีอุปกรณ์, บาดเจ็บ, ท่าเดิมทำไม่ถนัด, อยากเพิ่มความหลากหลาย)
แนวทางการตอบ:
- แนะนำท่าที่ทำงานกล้ามเนื้อกลุ่มเดียวกันกับท่าเดิมเป็นหลัก เพื่อให้โปรแกรมยังคงสมดุล
- ถ้าผู้ใช้บอกว่าเจ็บหรือบาดเจ็บ ให้เตือนอย่างสุภาพว่าควรปรึกษาแพทย์หรือนักกายภาพบำบัดก่อน ไม่วินิจฉัยอาการเอง และแนะนำท่าที่เลี่ยงบริเวณที่บาดเจ็บ
- ถามคำถามตอบกลับสั้นๆ ได้ถ้าข้อมูลไม่พอ เช่น ถามว่ามีอุปกรณ์อะไรบ้าง
- ให้จำนวนเซ็ต/reps แนะนำประกอบด้วยเมื่อเหมาะสม
- ตอบสั้น กระชับ ไม่ต้องยาวเกินจำเป็น`;

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
}));

async function start() {
  try {
    await db.migrate();
    console.log("[db] Migration complete");
  } catch (e) {
    console.error("[db] Migration failed — check DATABASE_URL:", e.message);
  }
  app.listen(PORT, () => {
    console.log(`Fitness tracker running on http://localhost:${PORT}`);
  });
}

start();
