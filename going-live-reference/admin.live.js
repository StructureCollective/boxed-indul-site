let adminKey = "";

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("unlockBtn").addEventListener("click", unlock);
  document.getElementById("adminKey").addEventListener("keydown", (e) => {
    if (e.key === "Enter") unlock();
  });
  document.getElementById("refreshBtn").addEventListener("click", loadBookings);
});

async function unlock() {
  const key = document.getElementById("adminKey").value.trim();
  const msg = document.getElementById("lockMsg");
  if (!key) return;

  adminKey = key;
  const res = await fetch("/api/admin/bookings", {
    headers: { "X-Admin-Key": adminKey },
  });

  if (res.status === 401) {
    msg.textContent = "Incorrect passcode.";
    msg.style.color = "#d98f8f";
    adminKey = "";
    return;
  }

  document.getElementById("lockScreen").style.display = "none";
  document.getElementById("adminPanel").style.display = "block";
  const data = await res.json();
  renderBookings(data.bookings || []);
}

async function loadBookings() {
  const res = await fetch("/api/admin/bookings", {
    headers: { "X-Admin-Key": adminKey },
  });
  if (!res.ok) return;
  const data = await res.json();
  renderBookings(data.bookings || []);
}

function renderBookings(bookings) {
  const list = document.getElementById("bookingList");
  if (!bookings.length) {
    list.innerHTML = `<p style="color:var(--muted);">No pending requests right now.</p>`;
    return;
  }
  list.innerHTML = bookings.map(bookingRow).join("");

  list.querySelectorAll("[data-approve]").forEach((btn) =>
    btn.addEventListener("click", () => act(btn.dataset.approve, "approve", btn))
  );
  list.querySelectorAll("[data-reject]").forEach((btn) =>
    btn.addEventListener("click", () => act(btn.dataset.reject, "reject", btn))
  );
}

function bookingRow(b) {
  return `
    <div class="booking-row" id="row-${b.id}">
      <div class="top">
        <strong>${escapeHtml(b.name)} — ${escapeHtml(b.event_date)}</strong>
        <span class="status-pill status-pending">Pending</span>
      </div>
      <dl>
        <dt>Occasion</dt><dd>${escapeHtml(b.event_type)}</dd>
        <dt>Boxes</dt><dd>${escapeHtml(String(b.guest_count))}</dd>
        <dt>Location</dt><dd>${escapeHtml(b.location || "—")}</dd>
        <dt>Budget</dt><dd>${escapeHtml(b.budget || "—")}</dd>
        <dt>Email</dt><dd>${escapeHtml(b.email)}</dd>
        <dt>Phone</dt><dd>${escapeHtml(b.phone || "—")}</dd>
        <dt>Notes</dt><dd>${escapeHtml(b.notes || "—")}</dd>
        <dt>Deposit</dt><dd>$${((b.deposit_amount_cents || 0) / 100).toFixed(2)}</dd>
      </dl>
      <div class="actions">
        <button class="btn btn-primary" data-approve="${b.id}">Approve &amp; Send Deposit Link</button>
        <button class="btn btn-outline" data-reject="${b.id}">Reject</button>
      </div>
    </div>`;
}

async function act(id, action, btn) {
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "Working…";
  try {
    const res = await fetch(`/api/admin/bookings/${id}/${action}`, {
      method: "POST",
      headers: { "X-Admin-Key": adminKey },
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || "Something went wrong.");
      btn.disabled = false;
      btn.textContent = original;
      return;
    }
    const row = document.getElementById(`row-${id}`);
    if (row) row.remove();
  } catch (err) {
    console.error(err);
    alert("Network error.");
    btn.disabled = false;
    btn.textContent = original;
  }
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
