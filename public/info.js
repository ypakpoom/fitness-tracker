function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function renderComputed(computed) {
  document.getElementById("calcBmr").textContent = computed.bmr;
  document.getElementById("calcTdee").textContent = computed.tdee;
  document.getElementById("calcTarget").textContent = computed.target_calories;
  document.getElementById("calcProtein").textContent = computed.protein_g;
  document.getElementById("calcNote").textContent =
    `น้ำหนักล่าสุดที่ใช้คำนวณ: ${computed.weight_kg} กก. · ${computed.activity_label} · เป้าหมาย: ${computed.goal_label} ` +
    `· คาร์บ ${computed.carbs_g}g · ไขมัน ${computed.fat_g}g`;
}

function showPageError(msg) {
  let el = document.getElementById("pageError");
  if (!el) {
    el = document.createElement("div");
    el.id = "pageError";
    el.style.cssText =
      "background:rgba(226,88,44,0.12);border:1px solid #7a3a24;color:#efece4;border-radius:10px;padding:12px 14px;margin:0 0 16px;font-size:13px;line-height:1.6;";
    document.querySelector("main").prepend(el);
  }
  el.textContent = msg;
}

function clearPageError() {
  const el = document.getElementById("pageError");
  if (el) el.remove();
}

async function loadSettings() {
  try {
    const res = await fetch("/api/settings");
    if (!res.ok) throw new Error(`API ตอบกลับด้วยสถานะ ${res.status}`);
    const data = await res.json();
    if (!data.activityLevels || !data.goals) throw new Error("ข้อมูลจากเซิร์ฟเวอร์ไม่ครบ");

    const activitySel = document.getElementById("sActivity");
    activitySel.innerHTML = data.activityLevels.map((a) => `<option value="${a.id}">${a.label}</option>`).join("");
    const goalSel = document.getElementById("sGoal");
    goalSel.innerHTML = data.goals.map((g) => `<option value="${g.id}">${g.label}</option>`).join("");

    document.getElementById("sGender").value = data.settings.gender;
    document.getElementById("sAge").value = data.settings.age;
    document.getElementById("sHeight").value = data.settings.height_cm;
    activitySel.value = data.settings.activity_level;
    goalSel.value = data.settings.goal;

    renderComputed(data.computed);
    clearPageError();
  } catch (e) {
    console.error("loadSettings failed:", e);
    showPageError(
      `โหลดข้อมูลโปรไฟล์ไม่ได้ (${e.message}) — ลองปิดเซิร์ฟเวอร์แล้วรัน "npm install" ตามด้วย "npm start" ใหม่ ` +
      `แล้วรีเฟรชหน้านี้แบบ hard refresh (Ctrl+Shift+R)`
    );
  }
}

async function saveSettings() {
  const payload = {
    gender: document.getElementById("sGender").value,
    age: document.getElementById("sAge").value,
    height_cm: document.getElementById("sHeight").value,
    activity_level: document.getElementById("sActivity").value,
    goal: document.getElementById("sGoal").value,
  };
  try {
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`API ตอบกลับด้วยสถานะ ${res.status}`);
    const data = await res.json();
    if (data.computed) renderComputed(data.computed);
    clearPageError();
  } catch (e) {
    console.error("saveSettings failed:", e);
    showPageError(`บันทึกโปรไฟล์ไม่สำเร็จ (${e.message}) — ลองรีสตาร์ทเซิร์ฟเวอร์แล้วโหลดหน้านี้ใหม่`);
  }
}

async function loadBodyLog() {
  try {
    const res = await fetch("/api/body-log");
    if (!res.ok) throw new Error(`API ตอบกลับด้วยสถานะ ${res.status}`);
    const data = await res.json();
    const list = document.getElementById("bodyLogList");
    list.innerHTML = "";

    if (data.entries.length === 0) {
      list.innerHTML = `<p class="empty-note">ยังไม่มีประวัติ — บันทึกน้ำหนักครั้งแรกด้านบนได้เลย</p>`;
      return;
    }

    data.entries.forEach((e, i) => {
      const prev = data.entries[i + 1];
      let diffLabel = "";
      if (prev) {
        const diff = +(e.weight_kg - prev.weight_kg).toFixed(1);
        const sign = diff > 0 ? "+" : "";
        diffLabel = ` <span style="color:${diff <= 0 ? "var(--go)" : "var(--warn)"}">(${sign}${diff} กก.)</span>`;
      }
      const row = document.createElement("div");
      row.className = "food-row";
      row.innerHTML = `
        <div class="fname">${e.date}${diffLabel}${e.note ? ` <span class="fmeal">· ${e.note}</span>` : ""}</div>
        <div class="fmacro">${e.weight_kg} กก.${e.body_fat_pct !== null && e.body_fat_pct !== undefined ? ` · BF ${e.body_fat_pct}%` : ""}</div>
        <button class="del" title="ลบ" data-id="${e.id}">✕</button>
      `;
      row.querySelector(".del").addEventListener("click", () => deleteBodyEntry(e.id));
      list.appendChild(row);
    });
    clearPageError();
  } catch (e) {
    console.error("loadBodyLog failed:", e);
    showPageError(`โหลดประวัติน้ำหนักไม่ได้ (${e.message}) — ลองรีสตาร์ทเซิร์ฟเวอร์แล้วโหลดหน้านี้ใหม่`);
  }
}

async function addBodyEntry() {
  const date = document.getElementById("bDate").value || todayStr();
  const weight = document.getElementById("bWeight").value;
  if (!weight) return;
  const payload = {
    date,
    weight_kg: weight,
    body_fat_pct: document.getElementById("bFat").value,
    note: document.getElementById("bNote").value,
  };
  try {
    const res = await fetch("/api/body-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `API ตอบกลับด้วยสถานะ ${res.status}`);
    }
    const data = await res.json();
    if (data.computed) renderComputed(data.computed);
    document.getElementById("bWeight").value = "";
    document.getElementById("bFat").value = "";
    document.getElementById("bNote").value = "";
    document.getElementById("bDate").value = todayStr();
    clearPageError();
    await loadBodyLog();
  } catch (e) {
    console.error("addBodyEntry failed:", e);
    showPageError(`บันทึกน้ำหนักไม่สำเร็จ (${e.message}) — ลองรีสตาร์ทเซิร์ฟเวอร์แล้วลองใหม่`);
  }
}

async function deleteBodyEntry(id) {
  try {
    const res = await fetch(`/api/body-log/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`API ตอบกลับด้วยสถานะ ${res.status}`);
    const data = await res.json();
    if (data.computed) renderComputed(data.computed);
    await loadBodyLog();
  } catch (e) {
    console.error("deleteBodyEntry failed:", e);
    showPageError(`ลบรายการไม่สำเร็จ (${e.message})`);
  }
}

document.getElementById("saveSettingsBtn").addEventListener("click", saveSettings);
document.getElementById("addBodyBtn").addEventListener("click", addBodyEntry);

(async function init() {
  document.getElementById("bDate").value = todayStr();
  await loadSettings();
  await loadBodyLog();
})();
