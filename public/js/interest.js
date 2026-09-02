// Hidden "interest" pages for targeted lunch drop-off outreach — not
// linked from the main nav, only reachable via a direct link/QR code.
// URL shape: /interest/?job=<slug> — slug must be a key in src/lib/jobs.js
// (INTEREST_JOBS), fetched here via GET /api/lunch-sale/interest-jobs so
// the page and the server stay in sync automatically as jobs are
// added/renamed there — no per-business HTML files to keep in sync.

document.addEventListener("DOMContentLoaded", init);

let currentJob = null;

async function init() {
  const area = document.getElementById("interestArea");
  const slug = new URLSearchParams(window.location.search).get("job");

  if (!slug) {
    renderInvalid(area);
    return;
  }

  try {
    const res = await fetch("/api/lunch-sale/interest-jobs");
    const data = await res.json();
    const label = (data.jobs || {})[slug];
    if (!label) {
      renderInvalid(area);
      return;
    }
    currentJob = slug;
    renderForm(area, label);
  } catch (err) {
    console.error("Failed to load interest page", err);
    renderInvalid(area);
  }
}

function renderInvalid(area) {
  area.innerHTML = `
    <div class="section-head">
      <h2>Link Not Found</h2>
      <p>This link doesn't match anything we have on file. If you were sent here about lunch drop-off, <a href="/contact/">reach out to us directly</a> and we'll get you sorted.</p>
    </div>`;
}

function renderForm(area, label) {
  document.title = `${label} Lunch Drop-Off — Boxed Indulgence`;
  area.innerHTML = `
    <div class="section-head">
      <p class="eyebrow">Lunch Drop-Off</p>
      <h2>Interested in Lunch Drop-Off at ${escapeHtml(label)}?</h2>
      <p>Leave your info and we'll follow up about setting up regular boxed-lunch drop-offs for ${escapeHtml(label)}.</p>
    </div>

    <form class="form-card" id="interestForm" style="text-align:left;max-width:420px;margin:0 auto;">
      <div class="field">
        <label for="contact_name">Your name</label>
        <input type="text" id="contact_name" name="contact_name" required>
      </div>
      <div class="field">
        <label for="email">Email</label>
        <input type="email" id="email" name="email" required placeholder="you@example.com">
      </div>
      <div class="field">
        <label for="phone">Phone</label>
        <input type="tel" id="phone" name="phone" required placeholder="(555) 555-5555">
        <p style="margin:6px 0 0;font-size:0.8rem;color:var(--muted);">By providing your phone number, you agree to receive occasional text updates about lunch drop-off from Boxed Indulgence. Message and data rates may apply.</p>
      </div>
      <button type="submit" class="btn btn-primary" id="interestBtn" style="width:100%;justify-content:center;">Get Notified</button>
      <div class="form-msg" id="interestMsg"></div>
    </form>`;

  document.getElementById("interestForm").addEventListener("submit", onSubmit);
}

async function onSubmit(e) {
  e.preventDefault();
  const msgEl = document.getElementById("interestMsg");
  const btn = document.getElementById("interestBtn");
  const contact_name = document.getElementById("contact_name").value.trim();
  const email = document.getElementById("email").value.trim();
  const phone = document.getElementById("phone").value.trim();
  if (!contact_name || !email || !phone) return;

  btn.disabled = true;
  btn.textContent = "Submitting…";

  try {
    const res = await fetch("/api/lunch-sale/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, contact_name, phone, source: currentJob }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      showMsg(msgEl, "error", data.error || "Something went wrong — please try again.");
      btn.disabled = false;
      btn.textContent = "Get Notified";
      return;
    }

    showMsg(msgEl, "success", "You're on the list! We'll be in touch.");
    document.getElementById("interestForm").reset();
    btn.textContent = "Submitted";
  } catch (err) {
    console.error(err);
    showMsg(msgEl, "error", "Network error — please try again.");
    btn.disabled = false;
    btn.textContent = "Get Notified";
  }
}

function showMsg(el, type, text) {
  el.className = `form-msg show ${type}`;
  el.textContent = text;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}
