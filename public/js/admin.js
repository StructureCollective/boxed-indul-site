// Admin approval page — sandbox version. Passcode check is a plain client-
// side constant, not real auth (there's no server to authenticate against
// in this preview). Fine for a demo; NOT a real security boundary — anyone
// who reads this file's source can see the passcode. Change it below if
// you want a different one for showing this to the client.
const ADMIN_PASSCODE = "preview";

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("unlockBtn").addEventListener("click", unlock);
  document.getElementById("adminKey").addEventListener("keydown", (e) => {
    if (e.key === "Enter") unlock();
  });
  document.getElementById("refreshBtn").addEventListener("click", loadBookings);
  document.getElementById("resetBtn").addEventListener("click", () => {
    if (confirm("Clear all sandbox bookings and contact messages in this browser? This can't be undone.")) {
      MockDB.resetAll();
      loadBookings();
    }
  });
});

function unlock() {
  const key = document.getElementById("adminKey").value.trim();
  const msg = document.getElementById("lockMsg");

  if (key !== ADMIN_PASSCODE) {
    msg.textContent = "Incorrect passcode.";
    msg.style.color = "#7a2e2e";
    return;
  }

  document.getElementById("lockScreen").style.display = "none";
  document.getElementById("adminPanel").style.display = "block";
  loadBookings();
}

function loadBookings() {
  const all = MockDB.getBookings();
  renderPending(all.filter((b) => b.status === "pending_approval"));
  renderApproved(all.filter((b) => b.status === "approved"));
  renderConfirmed(all.filter((b) => b.status === "confirmed"));
}

function renderPending(bookings) {
  const list = document.getElementById("pendingList");
  if (!bookings.length) {
    list.innerHTML = `<p style="color:var(--muted);">No pending requests right now.</p>`;
    return;
  }
  list.innerHTML = bookings.map(pendingRow).join("");

  list.querySelectorAll("[data-approve]").forEach((btn) =>
    btn.addEventListener("click", () => approve(btn.dataset.approve))
  );
  list.querySelectorAll("[data-reject]").forEach((btn) =>
    btn.addEventListener("click", () => reject(btn.dataset.reject))
  );
}

function renderApproved(bookings) {
  const section = document.getElementById("approvedSection");
  const list = document.getElementById("approvedList");
  if (!bookings.length) {
    section.style.display = "none";
    return;
  }
  section.style.display = "block";
  list.innerHTML = bookings.map(approvedRow).join("");
}

function renderConfirmed(bookings) {
  const section = document.getElementById("confirmedSection");
  const list = document.getElementById("confirmedList");
  if (!bookings.length) {
    section.style.display = "none";
    return;
  }
  section.style.display = "block";
  list.innerHTML = bookings.map(confirmedRow).join("");
}

function pendingRow(b) {
  return `
    <div class="booking-row" id="row-${b.id}">
      <div class="top">
        <strong>${escapeHtml(b.name)} — ${escapeHtml(b.event_date)}</strong>
        <span class="status-pill status-pending">Pending</span>
      </div>
      <dl>
        <dt>Occasion</dt><dd>${escapeHtml(b.event_type)}</dd>
        <dt>Boxes</dt><dd>${escapeHtml(String(b.guest_count))}</dd>
        <dt>Delivery to</dt><dd>${escapeHtml(b.location || "—")}</dd>
        <dt>Budget</dt><dd>${escapeHtml(b.budget || "—")}</dd>
        <dt>Email</dt><dd>${escapeHtml(b.email)}</dd>
        <dt>Phone</dt><dd>${escapeHtml(b.phone || "—")}</dd>
        <dt>Notes</dt><dd>${escapeHtml(b.notes || "—")}</dd>
        <dt>Deposit</dt><dd>$${((b.deposit_amount_cents || 0) / 100).toFixed(2)}</dd>
      </dl>
      <div class="actions">
        <button class="btn btn-primary" data-approve="${b.id}">Approve &amp; Generate Deposit Link</button>
        <button class="btn btn-outline" data-reject="${b.id}">Reject</button>
      </div>
    </div>`;
}

function approvedRow(b) {
  const link = `/booking/checkout/?booking=${b.id}`;
  return `
    <div class="booking-row">
      <div class="top">
        <strong>${escapeHtml(b.name)} — ${escapeHtml(b.event_date)}</strong>
        <span class="status-pill status-approved">Approved — awaiting deposit</span>
      </div>
      <p style="margin:6px 0 12px;">In the live site, this link gets emailed to the customer automatically. For this preview, open it yourself to simulate them paying:</p>
      <a class="btn btn-outline" href="${link}" target="_blank" rel="noopener">Open Deposit Page ↗</a>
    </div>`;
}

function confirmedRow(b) {
  return `
    <div class="booking-row">
      <div class="top">
        <strong>${escapeHtml(b.name)} — ${escapeHtml(b.event_date)}</strong>
        <span class="status-pill status-confirmed">Confirmed — deposit paid</span>
      </div>
    </div>`;
}

function approve(id) {
  MockDB.updateBookingStatus(id, "approved");
  loadBookings();
}

function reject(id) {
  MockDB.updateBookingStatus(id, "rejected");
  loadBookings();
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
