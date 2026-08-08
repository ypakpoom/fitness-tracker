// Shared helpers for date handling and the 7-day rack strip

function pad2(n) { return String(n).padStart(2, "0"); }

function toDateStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function todayStr() {
  return toDateStr(new Date());
}

// Returns array of 7 Date objects for the Mon->Sun week containing `date`
function weekDatesFor(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const dow = dt.getDay(); // 0 = Sun
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(dt);
  monday.setDate(dt.getDate() + mondayOffset);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(monday);
    day.setDate(monday.getDate() + i);
    days.push(day);
  }
  return days;
}

const THAI_DOW_SHORT = { sun: "อา", mon: "จ", tue: "อ", wed: "พ", thu: "พฤ", fri: "ศ", sat: "ส" };
const DOW_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function dayKeyForDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return DOW_KEYS[new Date(y, m - 1, d).getDay()];
}

// Renders the 7-day rack into `container`, calling onSelect(dateStr) on click.
// statusMap: { [dateStr]: 'complete' | 'partial' | 'rest' | undefined }
function renderDayRack(container, selectedDate, statusMap, onSelect) {
  const today = todayStr();
  const days = weekDatesFor(selectedDate);
  container.innerHTML = "";
  days.forEach((d) => {
    const ds = toDateStr(d);
    const key = dayKeyForDate(ds);
    const chip = document.createElement("div");
    chip.className = "day-chip";
    if (ds === today) chip.classList.add("today");
    if (ds === selectedDate) chip.classList.add("selected");
    const status = statusMap[ds];
    if (status) chip.classList.add(status);
    chip.innerHTML = `
      <span class="d">${THAI_DOW_SHORT[key]}</span>
      <span class="n">${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}</span>
      <span class="dot"></span>
    `;
    chip.addEventListener("click", () => onSelect(ds));
    container.appendChild(chip);
  });
}
