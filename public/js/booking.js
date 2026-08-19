// Availability calendar + order request form — sandbox version.
// Reads/writes MockDB (localStorage) instead of calling a server.

const DEPOSIT_AMOUNT_CENTS = 5000; // $50 flat, matches the going-live reference default

const state = {
  viewYear: null,
  viewMonth: null, // 0-indexed
  unavailable: new Set(),
  selectedDate: null, // 'YYYY-MM-DD'
};

document.addEventListener("DOMContentLoaded", () => {
  const today = new Date();
  state.viewYear = today.getFullYear();
  state.viewMonth = today.getMonth();

  document.getElementById("prevMonth").addEventListener("click", () => shiftMonth(-1));
  document.getElementById("nextMonth").addEventListener("click", () => shiftMonth(1));

  loadMonth();

  const form = document.getElementById("bookingForm");
  form.addEventListener("submit", onSubmit);

  const params = new URLSearchParams(window.location.search);
  const msgEl = document.getElementById("formMsg");
  if (params.get("paid") === "1") {
    showMsg(msgEl, "success", "Deposit received! Your date is confirmed. (Simulated — no real charge occurred.)");
  } else if (params.get("canceled") === "1") {
    showMsg(msgEl, "error", "Deposit payment was canceled.");
  }
});

function shiftMonth(delta) {
  state.viewMonth += delta;
  if (state.viewMonth < 0) { state.viewMonth = 11; state.viewYear -= 1; }
  if (state.viewMonth > 11) { state.viewMonth = 0; state.viewYear += 1; }
  loadMonth();
}

function loadMonth() {
  const monthStr = `${state.viewYear}-${String(state.viewMonth + 1).padStart(2, "0")}`;
  document.getElementById("calendarLabel").textContent = new Date(
    state.viewYear,
    state.viewMonth,
    1
  ).toLocaleDateString(undefined, { month: "long", year: "numeric" });

  state.unavailable = new Set(MockDB.unavailableDatesInMonth(monthStr));
  renderCalendar();
}

function renderCalendar() {
  const grid = document.getElementById("calendarGrid");
  grid.innerHTML = "";

  ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].forEach((d) => {
    const el = document.createElement("div");
    el.className = "dow";
    el.textContent = d;
    grid.appendChild(el);
  });

  const firstDay = new Date(state.viewYear, state.viewMonth, 1);
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(state.viewYear, state.viewMonth + 1, 0).getDate();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < startOffset; i++) {
    const el = document.createElement("div");
    el.className = "day empty";
    grid.appendChild(el);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateObj = new Date(state.viewYear, state.viewMonth, day);
    const dateStr = `${state.viewYear}-${String(state.viewMonth + 1).padStart(2, "0")}-${String(
      day
    ).padStart(2, "0")}`;

    const el = document.createElement("div");
    el.textContent = String(day);

    const isPast = dateObj < today;
    const isUnavailable = state.unavailable.has(dateStr);

    if (isPast) {
      el.className = "day past";
    } else if (isUnavailable) {
      el.className = "day unavailable";
    } else {
      el.className = "day available";
      if (dateStr === state.selectedDate) el.classList.add("selected");
      el.addEventListener("click", () => selectDate(dateStr, el));
    }

    grid.appendChild(el);
  }
}

function selectDate(dateStr, el) {
  state.selectedDate = dateStr;
  document.getElementById("event_date").value = formatDateNice(dateStr);
  document.getElementById("event_date").dataset.raw = dateStr;
  document
    .querySelectorAll(".calendar-grid .day.selected")
    .forEach((d) => d.classList.remove("selected"));
  el.classList.add("selected");
}

function formatDateNice(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function onSubmit(e) {
  e.preventDefault();
  const msgEl = document.getElementById("formMsg");
  const submitBtn = document.getElementById("submitBtn");
  const rawDate = document.getElementById("event_date").dataset.raw;

  if (!rawDate) {
    showMsg(msgEl, "error", "Please select a date on the calendar first.");
    return;
  }

  const name = document.getElementById("name").value.trim();
  const email = document.getElementById("email").value.trim();
  const eventType = document.getElementById("event_type").value;
  const guestCount = Number(document.getElementById("guest_count").value);

  if (!name || !email || !eventType || !guestCount) {
    showMsg(msgEl, "error", "Please fill in all required fields.");
    return;
  }

  const booking = {
    id: MockDB.newId(),
    name,
    email,
    phone: document.getElementById("phone").value.trim(),
    event_type: eventType,
    event_date: rawDate,
    guest_count: guestCount,
    budget: document.getElementById("budget").value.trim(),
    location: document.getElementById("location").value.trim(),
    notes: document.getElementById("notes").value.trim(),
    status: "pending_approval",
    deposit_amount_cents: DEPOSIT_AMOUNT_CENTS,
    created_at: MockDB.nowIso(),
    updated_at: MockDB.nowIso(),
  };

  submitBtn.disabled = true;
  submitBtn.textContent = "Sending…";

  // Simulate a brief network delay so the UX still feels real.
  setTimeout(() => {
    MockDB.addBooking(booking);
    showMsg(
      msgEl,
      "success",
      "Request sent! In the live site this notifies the business owner by email — for this preview, open /admin/ to review and approve it."
    );
    document.getElementById("bookingForm").reset();
    document.getElementById("event_date").dataset.raw = "";
    state.selectedDate = null;
    submitBtn.textContent = "Request Sent";
    loadMonth();
  }, 400);
}

function showMsg(el, type, text) {
  el.className = `form-msg show ${type}`;
  el.textContent = text;
}
