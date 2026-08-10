// Seed data used to populate Postgres on first run (only if tables are empty).
// After the first run, all editing happens through the app / database — this
// file is not read again, so editing it later has no effect on an existing DB.

const SEED_PROFILE = {
  gender: "ชาย",
  height_cm: 175,
  age: 38,
  activity_level: "light",
  goal: "fatloss",
};

const SEED_BODY_LOG = [
  { date: "2026-08-08", weight_kg: 82, body_fat_pct: null, note: "น้ำหนักเริ่มต้น" },
];

const SEED_DAYS = {
  mon: {
    label: "จันทร์",
    type: "gym",
    title: "Upper Body A",
    subtitle: "อก / หลัง / ไหล่",
    exercises: [
      { name: "Barbell Bench Press", target: "4 x 8-10" },
      { name: "Lat Pulldown", target: "4 x 10-12" },
      { name: "Seated Shoulder Press", target: "3 x 10-12" },
      { name: "Incline Dumbbell Press", target: "3 x 10-12" },
      { name: "Seated Cable Row", target: "3 x 12" },
      { name: "Lateral Raise", target: "3 x 15" },
    ],
  },
  tue: {
    label: "อังคาร",
    type: "gym",
    title: "Lower Body & Core",
    subtitle: "ขา (เครื่องเล่น + ฟรีเวท)",
    exercises: [
      { name: "Barbell Squat", target: "4 x 8-10" },
      { name: "Leg Press", target: "3 x 12" },
      { name: "Leg Curl", target: "3 x 12-15" },
      { name: "Standing Calf Raise", target: "4 x 15" },
      { name: "Plank", target: "3 x 45 วิ" },
      { name: "Cable Crunch", target: "3 x 15" },
    ],
  },
  wed: { label: "พุธ", type: "rest", title: "Rest Day", subtitle: "พักฟื้นกล้ามเนื้อ", exercises: [] },
  thu: {
    label: "พฤหัสบดี",
    type: "gym",
    title: "Upper Body B",
    subtitle: "หลัง / ไหล่ / แขน",
    exercises: [
      { name: "Deadlift", target: "4 x 6-8" },
      { name: "Pull-up / Lat Pulldown", target: "4 x 8-10" },
      { name: "Barbell Row", target: "3 x 10" },
      { name: "Face Pull", target: "3 x 15" },
      { name: "Barbell Curl", target: "3 x 12" },
      { name: "Triceps Pushdown", target: "3 x 12-15" },
    ],
  },
  fri: { label: "ศุกร์", type: "rest", title: "Rest Day", subtitle: "พักฟื้นกล้ามเนื้อ", exercises: [] },
  sat: {
    label: "เสาร์",
    type: "gym",
    title: "Full Body & Cardio",
    subtitle: "ที่บ้าน / ดัมเบล / บาร์ / น้ำหนักตัว",
    exercises: [
      { name: "Dumbbell Squat", target: "4 x 12" },
      { name: "Dumbbell Bench Press", target: "4 x 12" },
      { name: "Bent-over Dumbbell Row", target: "3 x 12" },
      { name: "Dumbbell Shoulder Press", target: "3 x 12" },
      { name: "Bodyweight Lunge", target: "3 x 12/ข้าง" },
      { name: "คาร์ดิโอ (เดินเร็ว/จั๊มปิ้ง แจ็ค)", target: "20 นาที" },
    ],
  },
  sun: { label: "อาทิตย์", type: "rest", title: "Rest Day", subtitle: "พักผ่อนเต็มที่", exercises: [] },
};

module.exports = { SEED_PROFILE, SEED_BODY_LOG, SEED_DAYS };
