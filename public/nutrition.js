let selectedDate = todayStr();

async function loadWeekStatus() {
  const days = weekDatesFor(selectedDate);
  const statusMap = {};
  await Promise.all(
    days.map(async (d) => {
      const ds = toDateStr(d);
      const res = await fetch(`/api/nutrition/${ds}`);
      const data = await res.json();
      const t = data.targets;
      if (!t) return;
      const cal = data.totals.calories;
      if (cal === 0) return;
      const low = t.target_calories - 75;
      const high = t.target_calories + 75;
      statusMap[ds] = cal >= low && cal <= high ? "complete" : "partial";
    })
  );
  return statusMap;
}

async function renderRack() {
  const statusMap = await loadWeekStatus();
  renderDayRack(document.getElementById("dayRack"), selectedDate, statusMap, selectDate);
}

function pct(val, target) {
  if (!target) return 0;
  return Math.max(0, Math.min(100, (val / target) * 100));
}

async function loadDay() {
  const res = await fetch(`/api/nutrition/${selectedDate}`);
  const data = await res.json();
  const { entries, totals, targets: t } = data;

  const isToday = selectedDate === todayStr();
  document.getElementById("eyebrow").textContent = isToday ? "วันนี้" : selectedDate;

  const calTarget = t.target_calories;
  const proTarget = t.protein_g;
  const carbTarget = t.carbs_g;
  const fatTarget = t.fat_g;

  document.getElementById("targetStrip").innerHTML =
    `เป้าหมาย ${calTarget} kcal · โปรตีน ${proTarget}g · คาร์บ ${carbTarget}g · ไขมัน ${fatTarget}g` +
    ` <span style="opacity:.7">(คำนวณจากน้ำหนัก ${t.weight_kg} กก. — <a href="info.html">แก้ไขได้ที่หน้า Info</a>)</span>`;

  document.getElementById("calVal").textContent = Math.round(totals.calories);
  document.getElementById("calTarget").textContent = `/ ${calTarget}`;
  document.getElementById("calBar").style.width = pct(totals.calories, calTarget) + "%";

  document.getElementById("proVal").textContent = Math.round(totals.protein);
  document.getElementById("proTarget").textContent = proTarget;
  document.getElementById("proBar").style.width = pct(totals.protein, proTarget) + "%";

  document.getElementById("carbVal").textContent = Math.round(totals.carbs);
  document.getElementById("carbTarget").textContent = carbTarget;
  document.getElementById("carbBar").style.width = pct(totals.carbs, carbTarget) + "%";

  document.getElementById("fatVal").textContent = Math.round(totals.fat);
  document.getElementById("fatTarget").textContent = fatTarget;
  document.getElementById("fatBar").style.width = pct(totals.fat, fatTarget) + "%";

  const list = document.getElementById("foodList");
  list.innerHTML = "";
  if (entries.length === 0) {
    list.innerHTML = `<p class="empty-note">ยังไม่มีรายการอาหารสำหรับวันนี้ — เพิ่มด้านล่างได้เลย</p>`;
  } else {
    entries.forEach((e) => {
      const row = document.createElement("div");
      row.className = "food-row";
      row.innerHTML = `
        <div class="fname">${e.food}${e.meal ? ` <span class="fmeal">· ${e.meal}</span>` : ""}</div>
        <div class="fmacro">${Math.round(e.calories)} kcal · P${Math.round(e.protein)} C${Math.round(e.carbs)} F${Math.round(e.fat)}</div>
        <button class="del" title="ลบ" data-id="${e.id}">✕</button>
      `;
      row.querySelector(".del").addEventListener("click", () => deleteEntry(e.id));
      list.appendChild(row);
    });
  }
}

async function deleteEntry(id) {
  await fetch(`/api/nutrition/${selectedDate}/${id}`, { method: "DELETE" });
  await loadDay();
  await renderRack();
}

async function addFood() {
  const food = document.getElementById("fFood").value.trim();
  if (!food) return;
  const payload = {
    food,
    meal: document.getElementById("fMeal").value,
    calories: document.getElementById("fCal").value,
    protein: document.getElementById("fPro").value,
    carbs: document.getElementById("fCarb").value,
    fat: document.getElementById("fFat").value,
  };
  await fetch(`/api/nutrition/${selectedDate}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  ["fFood", "fCal", "fPro", "fCarb", "fFat"].forEach((id) => (document.getElementById(id).value = ""));
  await loadDay();
  await renderRack();
}

async function selectDate(ds) {
  selectedDate = ds;
  await renderRack();
  await loadDay();
}

document.getElementById("addFoodBtn").addEventListener("click", addFood);

(async function init() {
  await renderRack();
  await loadDay();
})();
