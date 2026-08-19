// Availability calendar + booking request form.

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

  // Handle redirect back from Stripe checkout (paid=1 / canceled=1)
  const params = new URLSearchParams(window.location.search);
  const msgEl = document.getElementById("formMsg");
  if (params.get("paid") === "1") {
    showMsg(msgEl, "success", "Deposit received! Your date is confirmed — check your email for details.");
  } else if (params.get("canceled") === "1") {
    showMsg(msgEl, "error", "Deposit payment was canceled. You can retry from the approval email whenever you're ready.");
  }
});

async function shiftMonth(delta) {
  state.viewMonth += delta;
  if (state.viewMonth < 0) { state.viewMonth = 11; state.viewYear -= 1; }
  if (state.viewMonth > 11) { state.viewMonth = 0; state.viewYear += 1; }
  await loadMonth();
}

async function loadMonth() {
  const monthStr = `${state.viewYear}-${String(state.viewMonth + 1).padStart(2, "0")}`;
  document.getElementById("calendarLabel").textContent = new Date(
    state.viewYear,
    state.viewMonth,
    1
  ).toLocaleDateString(undefined, { month: "long", year: "numeric" });

  try {
    const res = await fetch(`/api/availability?month=${monthStr}`);
    const data = await res.json();
    state.unavailable = new Set(data.unavailable || []);
  } catch (err) {
    console.error("Failed to load availability", err);
    state.unavailable = new Set();
  }
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

async function onSubmit(e) {
  e.preventDefault();
  const msgEl = document.getElementById("formMsg");
  const submitBtn = document.getElementById("submitBtn");
  const rawDate = document.getElementById("event_date").dataset.raw;

  if (!rawDate) {
    showMsg(msgEl, "error", "Please select a date on the calendar first.");
    return;
  }

  const payload = {
    name: document.getElementById("name").value.trim(),
    email: document.getElementById("email").value.trim(),
    phone: document.getElementById("phone").value.trim(),
    event_type: document.getElementById("event_type").value,
    event_date: rawDate,
    guest_count: Number(document.getElementById("guest_count").value),
    budget: document.getElementById("budget").value.trim(),
    location: document.getElementById("location").value.trim(),
    notes: document.getElementById("notes").value.trim(),
  };

  submitBtn.disabled = true;
  submitBtn.textContent = "Sending…";

  try {
    const res = await fetch("/api/booking", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!res.ok) {
      showMsg(msgEl, "error", data.error || "Something went wrong — please try again.");
      submitBtn.disabled = false;
      submitBtn.textContent = "Request This Date";
      return;
    }

    showMsg(
      msgEl,
      "success",
      "Request sent! We'll review it and follow up by email — usually within 1–2 business days."
    );
    document.getElementById("bookingForm").reset();
    document.getElementById("event_date").dataset.raw = "";
    state.selectedDate = null;
    submitBtn.textContent = "Request Sent";
    await loadMonth();
  } catch (err) {
    console.error(err);
    showMsg(msgEl, "error", "Network error — please try again.");
    submitBtn.disabled = false;
    submitBtn.textContent = "Request This Date";
  }
}

function showMsg(el, type, text) {
  el.className = `form-msg show ${type}`;
  el.textContent = text;
}
