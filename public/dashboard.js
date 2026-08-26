let selectedDate = todayStr();
let weekSummary = {};

async function loadWeekSummary() {
  const res = await fetch("/api/workout-summary");
  const data = await res.json();
  weekSummary = {};
  Object.entries(data).forEach(([date, s]) => {
    weekSummary[date] = s.complete ? "complete" : s.partial ? "partial" : undefined;
  });
}

function markRestDays(statusMap) {
  weekDatesFor(selectedDate).forEach((d) => {
    const ds = toDateStr(d);
    const key = dayKeyForDate(ds);
    if (["wed", "fri", "sun"].includes(key) && !statusMap[ds]) {
      statusMap[ds] = "rest";
    }
  });
  return statusMap;
}

async function renderRack() {
  await loadWeekSummary();
  renderDayRack(
    document.getElementById("dayRack"),
    selectedDate,
    markRestDays({ ...weekSummary }),
    selectDate
  );
}

function checkIcon() {
  return `<svg viewBox="0 0 20 20" fill="none"><path d="M4 10.5L8 14.5L16 6" stroke="#181a1e" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

let currentDayKey = null;
let currentExercises = [];
let editingExerciseId = null;

async function loadDay() {
  editingExerciseId = null;
  const res = await fetch(`/api/workout/${selectedDate}`);
  const data = await res.json();
  const { day, dayKey, completed } = data;
  currentDayKey = dayKey;
  currentExercises = day.exercises || [];

  const isToday = selectedDate === todayStr();
  document.getElementById("eyebrow").textContent = isToday ? "วันนี้" : selectedDate;
  document.getElementById("dayTitle").textContent = day.title;
  document.getElementById("daySub").textContent = day.subtitle || "";

  const list = document.getElementById("exerciseList");
  list.innerHTML = "";

  const isRest = day.type === "rest";

  if (isRest && currentExercises.length === 0) {
    // Still a rest day by default, but the add-exercise row stays available
    // so exercises can be added on any day, including rest days.
    document.getElementById("progressNum").textContent = "—";
    list.innerHTML = `<div class="rest-card"><div class="big">พักผ่อน</div><p>วันนี้ไม่มีตารางยกเวท ให้ร่างกายได้ฟื้นตัวเต็มที่ หรือจะเพิ่มท่าออกกำลังกายเองก็ได้ด้านล่าง</p></div>`;
    renderAddExerciseRow();
    return;
  }

  const doneCount = currentExercises.filter((ex) => completed[ex.id] === "done").length;
  document.getElementById("progressNum").textContent = `${doneCount}/${currentExercises.length}`;

  renderExerciseRows(completed);
  renderAddExerciseRow();
}

function renderExerciseRows(completed) {
  const list = document.getElementById("exerciseList");
  list.innerHTML = "";

  currentExercises.forEach((ex) => {
    const status = completed[ex.id] || "none";

    if (editingExerciseId === ex.id) {
      list.appendChild(buildEditRow(ex));
      return;
    }

    const row = document.createElement("div");
    row.className = "exercise" + (status === "done" ? " done" : status === "partial" ? " partial" : "");
    row.innerHTML = `
      <div class="checkbox">${checkIcon()}<span class="dash"></span></div>
      <div class="ex-body">
        <div class="ex-name">${ex.name}</div>
        <div class="ex-target">${ex.target}</div>
      </div>
      <div class="ex-actions">
        <button class="edit-btn" title="แก้ไข">✎</button>
        <button class="del-btn" title="ลบ">✕</button>
      </div>
    `;
    row.addEventListener("click", (e) => {
      if (e.target.closest(".ex-actions")) return;
      cycleExerciseStatus(ex.id, status);
    });
    row.querySelector(".edit-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      editingExerciseId = ex.id;
      renderExerciseRows(completed);
    });
    row.querySelector(".del-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      deleteExercise(ex.id, ex.name);
    });
    list.appendChild(row);
  });
}

function buildEditRow(ex) {
  const row = document.createElement("div");
  row.className = "exercise editing";
  row.innerHTML = `
    <div class="ex-edit-form">
      <input type="text" name="name" value="${ex.name.replace(/"/g, "&quot;")}" placeholder="ชื่อท่า">
      <input type="text" name="target" value="${ex.target.replace(/"/g, "&quot;")}" placeholder="เช่น 3 x 10">
      <div class="ex-edit-actions">
        <button class="btn" style="padding:8px 12px;">บันทึก</button>
        <button class="btn ghost" style="padding:8px 12px;">ยกเลิก</button>
      </div>
    </div>
  `;
  const [nameInput, targetInput] = row.querySelectorAll("input");
  const [saveBtn, cancelBtn] = row.querySelectorAll("button");
  saveBtn.addEventListener("click", () => saveExerciseEdit(ex.id, nameInput.value.trim(), targetInput.value.trim()));
  cancelBtn.addEventListener("click", () => {
    editingExerciseId = null;
    loadDay();
  });
  return row;
}

function renderAddExerciseRow() {
  const main = document.querySelector("main");
  let addRow = document.getElementById("addExerciseRow");
  if (addRow) addRow.remove();

  addRow = document.createElement("div");
  addRow.id = "addExerciseRow";
  addRow.className = "add-exercise-row";
  addRow.innerHTML = `
    <input type="text" name="name" placeholder="ชื่อท่าใหม่ เช่น Cable Fly">
    <input type="text" name="target" placeholder="เช่น 3 x 12">
    <button class="btn">+ เพิ่มท่า</button>
  `;
  const [nameInput, targetInput] = addRow.querySelectorAll("input");
  addRow.querySelector("button").addEventListener("click", () => addExercise(nameInput.value.trim(), targetInput.value.trim()));
  document.getElementById("exerciseList").insertAdjacentElement("afterend", addRow);
}

async function cycleExerciseStatus(exerciseId, currentStatus) {
  const next = currentStatus === "none" ? "partial" : currentStatus === "partial" ? "done" : "none";
  await fetch(`/api/workout/${selectedDate}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ exerciseId, status: next }),
  });
  await loadDay();
  await renderRack();
}

async function addExercise(name, target) {
  if (!name || !currentDayKey) return;
  const res = await fetch(`/api/program/${currentDayKey}/exercises`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, target }),
  });
  if (res.ok) {
    await loadDay();
    await renderRack();
  }
}

async function saveExerciseEdit(exerciseId, name, target) {
  if (!name || !currentDayKey) return;
  const res = await fetch(`/api/program/${currentDayKey}/exercises/${exerciseId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, target }),
  });
  if (res.ok) {
    editingExerciseId = null;
    await loadDay();
  }
}

async function deleteExercise(exerciseId, name) {
  if (!currentDayKey) return;
  if (!confirm(`ลบท่า "${name}" ออกจากโปรแกรมใช่ไหม?`)) return;
  const res = await fetch(`/api/program/${currentDayKey}/exercises/${exerciseId}`, { method: "DELETE" });
  if (res.ok) {
    await loadDay();
    await renderRack();
  }
}

async function selectDate(ds) {
  selectedDate = ds;
  await renderRack();
  await loadDay();
}

// ---- Exercise chat assistant ----
let chatHistory = []; // { role: 'user'|'assistant', content: string }

function appendChatMsg(role, text, opts = {}) {
  const log = document.getElementById("chatLog");
  const el = document.createElement("div");
  el.className = `chat-msg ${role}` + (opts.pending ? " pending" : "") + (opts.error ? " error" : "");
  el.textContent = text;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  return el;
}

async function sendChat() {
  const input = document.getElementById("chatInput");
  const text = input.value.trim();
  if (!text) return;

  const sendBtn = document.getElementById("chatSendBtn");
  input.value = "";
  input.disabled = true;
  sendBtn.disabled = true;

  appendChatMsg("user", text);
  chatHistory.push({ role: "user", content: text });

  const pendingEl = appendChatMsg("assistant", "กำลังพิมพ์...", { pending: true });

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: selectedDate, messages: chatHistory }),
    });
    const data = await res.json();

    if (!res.ok || data.error) {
      pendingEl.remove();
      appendChatMsg("assistant", data.error || "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง", { error: true });
      chatHistory.pop(); // remove the user turn so retry doesn't duplicate context oddly
    } else {
      pendingEl.classList.remove("pending");
      pendingEl.textContent = data.reply;
      chatHistory.push({ role: "assistant", content: data.reply });
    }
  } catch (e) {
    pendingEl.remove();
    appendChatMsg("assistant", "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง", { error: true });
  } finally {
    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
  }
}

document.getElementById("chatSendBtn").addEventListener("click", sendChat);
document.getElementById("chatInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendChat();
});

(async function init() {
  await renderRack();
  await loadDay();
})();
