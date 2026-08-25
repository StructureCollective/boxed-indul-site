// Admin dashboard — Cloudflare Access protects /admin/* at the edge, so
// there's no passcode here: if this page loaded at all, Access already
// verified the signed-in email against the allowed list. Every fetch below
// rides the same-origin CF_Authorization session cookie automatically.

let bookings = [];
let contacts = [];
let lunchEvents = [];
let lunchOrders = [];
let signups = [];
let blockedDates = [];
let dropoffRowCount = 0;

document.addEventListener("DOMContentLoaded", () => {
  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  wireTabs();
  wireBookings();
  wireLunchEvents();
  wireLunchOrders();
  wireContacts();
  wireCalendar();
  wireBlockedDates();
  wireAdminCalendar();

  loadBookings();
  loadContacts();
  loadLunchEvents();
  loadLunchOrders();
  loadSignups();
  loadCalendarStatus();
  loadBlockedDates();
  renderAdminCalendar();

  if (window.location.hash === "#calendar-connected") {
    showGlobalMsg("success", "Google Calendar connected.");
    history.replaceState(null, "", window.location.pathname);
  }
});

// ---- tabs -----------------------------------------------------------------

function wireTabs() {
  const buttons = document.querySelectorAll(".admin-tabs .tab-btn");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".admin-panel").forEach((p) => p.classList.remove("active"));
      document.getElementById(btn.dataset.panel)?.classList.add("active");
    });
  });
}

function showGlobalMsg(type, text) {
  const el = document.getElementById("globalMsg");
  el.className = `form-msg show ${type}`;
  el.textContent = text;
  setTimeout(() => {
    el.className = "form-msg";
  }, 6000);
}

// ---- shared fetch helper ---------------------------------------------------

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ---- bookings (custom orders) ---------------------------------------------

function wireBookings() {
  document.getElementById("bookingsRefresh").addEventListener("click", loadBookings);
  document.getElementById("bookingsSearch").addEventListener("input", renderBookings);
}

async function loadBookings() {
  try {
    const data = await api("/api/admin/bookings");
    bookings = data.bookings || [];
    renderBookings();
    renderAdminCalendar();
  } catch (err) {
    showGlobalMsg("error", err.message);
  }
}

function renderBookings() {
  const q = document.getElementById("bookingsSearch").value.trim().toLowerCase();
  const filtered = q
    ? bookings.filter((b) =>
        [b.name, b.email, b.event_date, b.event_type, b.location].some((v) =>
          String(v || "").toLowerCase().includes(q)
        )
      )
    : bookings;

  const body = document.getElementById("bookingsBody");
  if (!filtered.length) {
    body.innerHTML = `<tr><td colspan="8" class="subtle">No orders found.</td></tr>`;
    return;
  }
  body.innerHTML = filtered.map(bookingRow).join("");

  body.querySelectorAll("[data-approve]").forEach((btn) =>
    btn.addEventListener("click", () => approveBooking(btn.dataset.approve))
  );
  body.querySelectorAll("[data-approve-edit]").forEach((btn) =>
    btn.addEventListener("click", () => approveBookingWithOverride(btn.dataset.approveEdit))
  );
  body.querySelectorAll("[data-reject]").forEach((btn) =>
    btn.addEventListener("click", () => rejectBooking(btn.dataset.reject))
  );
  body.querySelectorAll("[data-resend]").forEach((btn) =>
    btn.addEventListener("click", () => resendDepositLink(btn.dataset.resend))
  );
  body.querySelectorAll("[data-details]").forEach((btn) =>
    btn.addEventListener("click", () => toggleDetails(btn.dataset.details))
  );
}

function bookingRow(b) {
  const total = b.order_total_cents != null ? `$${(b.order_total_cents / 100).toFixed(2)}` : "Quoted";
  const deposit = b.deposit_amount_cents != null ? `$${(b.deposit_amount_cents / 100).toFixed(2)}` : "—";
  const statusClass = `status-${b.status === "pending_approval" ? "pending" : b.status}`;

  let actions = `<button class="btn btn-outline" data-details="${b.id}" style="padding:6px 12px;font-size:0.7rem;">Details</button>`;
  if (b.status === "pending_approval") {
    actions += `
      <button class="btn btn-primary" data-approve="${b.id}">Approve</button>
      <button class="btn btn-outline" data-approve-edit="${b.id}">Edit &amp; Approve</button>
      <button class="btn btn-outline" data-reject="${b.id}" style="border-color:var(--maroon);color:var(--maroon);">Reject</button>`;
  } else if (b.status === "approved") {
    actions += `<button class="btn btn-outline" data-resend="${b.id}">Resend Deposit Link</button>`;
  }

  return `
    <tr id="row-${b.id}">
      <td>${escapeHtml(b.name)}</td>
      <td>${escapeHtml(b.event_date)}</td>
      <td>${escapeHtml(b.event_type || "—")}</td>
      <td>${escapeHtml(String(b.guest_count ?? "—"))}</td>
      <td>${total}</td>
      <td>${deposit}</td>
      <td><span class="status-pill ${statusClass}">${escapeHtml(b.status.replace(/_/g, " "))}</span></td>
      <td><div class="row-actions">${actions}</div></td>
    </tr>
    <tr id="details-${b.id}" style="display:none;">
      <td colspan="8" class="wrap-cell">${bookingDetailsHtml(b)}</td>
    </tr>`;
}

function bookingDetailsHtml(b) {
  const items = parseOrderItems(b.order_items);
  const itemsHtml = items.length
    ? `<ul style="margin:8px 0;padding-left:18px;">${items
        .map(
          (i) =>
            `<li>${escapeHtml(i.item || i.name || "Item")}${i.qty ? ` × ${escapeHtml(String(i.qty))}` : ""}${
              i.line_total_cents != null ? ` — $${(i.line_total_cents / 100).toFixed(2)}` : ""
            }</li>`
        )
        .join("")}</ul>`
    : `<p class="subtle" style="margin:8px 0;">No itemized selections on file.</p>`;

  return `
    <strong>Email:</strong> ${escapeHtml(b.email)} &nbsp; <strong>Phone:</strong> ${escapeHtml(b.phone || "—")}<br>
    <strong>Location:</strong> ${escapeHtml(b.location || "—")} &nbsp; <strong>Budget:</strong> ${escapeHtml(
    b.budget || "—"
  )}<br>
    <strong>Menu:</strong> ${escapeHtml(b.menu_type || "—")}
    ${itemsHtml}
    <strong>Notes:</strong> ${escapeHtml(b.notes || "—")}`;
}

function parseOrderItems(raw) {
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toggleDetails(id) {
  const row = document.getElementById(`details-${id}`);
  if (row) row.style.display = row.style.display === "none" ? "table-row" : "none";
}

async function approveBooking(id) {
  try {
    await api(`/api/admin/bookings/${id}/approve`, { method: "POST", body: JSON.stringify({}) });
    showGlobalMsg("success", "Order approved — deposit link emailed to the customer.");
    loadBookings();
  } catch (err) {
    showGlobalMsg("error", err.message);
  }
}

async function approveBookingWithOverride(id) {
  const input = window.prompt("Override order total in dollars (leave blank to keep the computed total):");
  if (input === null) return;
  const body = {};
  if (input.trim() !== "") {
    const dollars = Number(input);
    if (!Number.isFinite(dollars) || dollars < 0) {
      showGlobalMsg("error", "Enter a valid dollar amount.");
      return;
    }
    body.override_total_cents = Math.round(dollars * 100);
  }
  try {
    await api(`/api/admin/bookings/${id}/approve`, { method: "POST", body: JSON.stringify(body) });
    showGlobalMsg("success", "Order approved — deposit link emailed to the customer.");
    loadBookings();
  } catch (err) {
    showGlobalMsg("error", err.message);
  }
}

async function rejectBooking(id) {
  if (!confirm("Reject this order request? The customer will be notified by email.")) return;
  try {
    await api(`/api/admin/bookings/${id}/reject`, { method: "POST" });
    showGlobalMsg("success", "Order rejected.");
    loadBookings();
  } catch (err) {
    showGlobalMsg("error", err.message);
  }
}

async function resendDepositLink(id) {
  try {
    await api(`/api/admin/bookings/${id}/resend-deposit-link`, { method: "POST" });
    showGlobalMsg("success", "Deposit link resent with a fresh expiration.");
    loadBookings();
  } catch (err) {
    showGlobalMsg("error", err.message);
  }
}

// ---- lunch sale events ------------------------------------------------------

function wireLunchEvents() {
  addDropoffRow();
  document.getElementById("addDropoff").addEventListener("click", () => addDropoffRow());
  document.getElementById("lunchEventForm").addEventListener("submit", onCreateLunchEvent);
  document.getElementById("eventsRefresh").addEventListener("click", loadLunchEvents);
}

function addDropoffRow() {
  dropoffRowCount += 1;
  const wrap = document.getElementById("dropoffRows");
  const row = document.createElement("div");
  row.className = "dropoff-row";
  row.innerHTML = `
    <input type="text" placeholder="Time (e.g. 12:00–1:00pm)" class="dropoff-time">
    <input type="text" placeholder="Location" class="dropoff-location">
    <button type="button" class="btn btn-outline" style="padding:8px 12px;font-size:0.7rem;">Remove</button>`;
  row.querySelector("button").addEventListener("click", () => row.remove());
  wrap.appendChild(row);
}

async function onCreateLunchEvent(e) {
  e.preventDefault();
  const msgEl = document.getElementById("lunchEventMsg");
  const btn = document.getElementById("ev_submit");

  const dropoff_options = Array.from(document.querySelectorAll("#dropoffRows .dropoff-row"))
    .map((row) => ({
      time: row.querySelector(".dropoff-time").value.trim(),
      location: row.querySelector(".dropoff-location").value.trim(),
    }))
    .filter((d) => d.time && d.location);

  if (!dropoff_options.length) {
    showMsg(msgEl, "error", "Add at least one drop-off time and location.");
    return;
  }

  const priceDollars = Number(document.getElementById("ev_price").value);
  const cutoffLocal = document.getElementById("ev_cutoff").value;

  const payload = {
    title: document.getElementById("ev_title").value.trim(),
    menu_description: document.getElementById("ev_menu").value.trim(),
    price_cents: Math.round(priceDollars * 100),
    sale_date: document.getElementById("ev_sale_date").value,
    order_cutoff_at: cutoffLocal ? new Date(cutoffLocal).toISOString() : "",
    slot_cap: Number(document.getElementById("ev_slot_cap").value),
    max_qty_per_order: Number(document.getElementById("ev_max_qty").value) || 10,
    status: document.getElementById("ev_status").value,
    dropoff_options,
  };

  btn.disabled = true;
  btn.textContent = "Creating…";
  try {
    await api("/api/admin/lunch-sale/events", { method: "POST", body: JSON.stringify(payload) });
    showMsg(msgEl, "success", "Lunch sale event created.");
    document.getElementById("lunchEventForm").reset();
    document.getElementById("dropoffRows").innerHTML = "";
    addDropoffRow();
    loadLunchEvents();
  } catch (err) {
    showMsg(msgEl, "error", err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Create Event";
  }
}

async function loadLunchEvents() {
  try {
    const data = await api("/api/admin/lunch-sale/events");
    lunchEvents = data.events || [];
    renderLunchEvents();
    populateOrdersEventFilter();
  } catch (err) {
    showGlobalMsg("error", err.message);
  }
}

function renderLunchEvents() {
  const list = document.getElementById("eventsList");
  if (!lunchEvents.length) {
    list.innerHTML = `<p class="subtle">No lunch sale events yet — create one above.</p>`;
    return;
  }
  list.innerHTML = lunchEvents.map(eventCard).join("");

  list.querySelectorAll("[data-set-status]").forEach((btn) =>
    btn.addEventListener("click", () => setEventStatus(btn.dataset.setStatus, btn.dataset.status))
  );
  list.querySelectorAll("[data-notify]").forEach((btn) =>
    btn.addEventListener("click", () => notifySignups(btn.dataset.notify))
  );
  list.querySelectorAll("[data-delete-event]").forEach((btn) =>
    btn.addEventListener("click", () => deleteLunchEvent(btn.dataset.deleteEvent))
  );
  list.querySelectorAll("[data-export-event]").forEach((btn) =>
    btn.addEventListener("click", () => exportEventOrders(btn.dataset.exportEvent))
  );
}

// Keeps the Orders tab's event filter dropdown in sync with whatever
// events exist. Safe to call before lunchOrders/lunchEvents are loaded —
// it just re-runs once the data shows up.
function populateOrdersEventFilter() {
  const sel = document.getElementById("ordersEventFilter");
  if (!sel) return;
  const current = sel.value;
  const options = [`<option value="">All events (full history)</option>`].concat(
    lunchEvents.map(
      (ev) =>
        `<option value="${escapeHtml(ev.id)}">${escapeHtml(ev.title)} — ${escapeHtml(
          formatShortDate(ev.sale_date)
        )}</option>`
    )
  );
  sel.innerHTML = options.join("");
  if (current && lunchEvents.some((ev) => ev.id === current)) sel.value = current;
}

function eventCard(ev) {
  const dropoffs = parseOrderItems(ev.dropoff_options);
  const dropoffText = dropoffs.map((d) => `${d.time} — ${d.location}`).join(" · ") || "—";

  let actions = "";
  if (ev.status === "draft") {
    actions += `<button class="btn btn-primary" data-set-status="${ev.id}" data-status="live">Make Live</button>`;
  }
  if (ev.status === "live") {
    actions += `<button class="btn btn-outline" data-set-status="${ev.id}" data-status="closed">Close Ordering</button>`;
    actions += `<button class="btn btn-outline" data-set-status="${ev.id}" data-status="canceled" style="border-color:var(--maroon);color:var(--maroon);">Cancel</button>`;
  }
  actions += `<button class="btn btn-outline" data-notify="${ev.id}">Notify Signups</button>`;
  actions += `<button class="btn btn-outline" data-export-event="${ev.id}">Export Orders</button>`;
  actions += `<button class="btn btn-outline" data-delete-event="${ev.id}" style="border-color:var(--maroon);color:var(--maroon);">Delete</button>`;

  return `
    <div class="event-card">
      <div class="top">
        <strong>${escapeHtml(ev.title)}</strong>
        <span class="status-pill status-${escapeHtml(ev.status)}">${escapeHtml(ev.status)}</span>
      </div>
      <p class="subtle" style="margin-bottom:6px;">${escapeHtml(ev.menu_description)}</p>
      <p class="subtle" style="margin-bottom:6px;">
        For ${escapeHtml(ev.sale_date)} · $${(ev.price_cents / 100).toFixed(2)}/lunch ·
        cap ${escapeHtml(String(ev.slot_cap))} orders · cutoff ${escapeHtml(formatDateTime(ev.order_cutoff_at))}
      </p>
      <p class="subtle" style="margin-bottom:0;">Drop-off: ${escapeHtml(dropoffText)}</p>
      <div class="actions">${actions}</div>
    </div>`;
}

async function setEventStatus(id, status) {
  if (status === "canceled" && !confirm("Cancel this lunch sale? It will no longer be orderable.")) return;
  try {
    await api(`/api/admin/lunch-sale/events/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    showGlobalMsg("success", `Event status updated to "${status}".`);
    loadLunchEvents();
  } catch (err) {
    showGlobalMsg("error", err.message);
  }
}

async function deleteLunchEvent(id) {
  if (!confirm("Delete this lunch sale event? This can't be undone.")) return;
  try {
    await api(`/api/admin/lunch-sale/events/${id}`, { method: "DELETE" });
    showGlobalMsg("success", "Lunch sale event deleted.");
    loadLunchEvents();
  } catch (err) {
    showGlobalMsg("error", err.message);
  }
}

async function notifySignups(id) {
  try {
    const data = await api(`/api/admin/lunch-sale/events/${id}/notify-signups`, { method: "POST" });
    showGlobalMsg("success", `Notified ${data.sent} of ${data.total} signed-up email(s).`);
  } catch (err) {
    showGlobalMsg("error", err.message);
  }
}

// ---- lunch sale orders + signups -------------------------------------------

function wireLunchOrders() {
  document.getElementById("ordersRefresh").addEventListener("click", loadLunchOrders);
  document.getElementById("ordersSearch").addEventListener("input", renderLunchOrders);
  document.getElementById("ordersEventFilter").addEventListener("change", renderLunchOrders);
  document.getElementById("ordersDownload").addEventListener("click", () => {
    exportOrdersToExcel(getFilteredOrders(), currentOrdersExportName());
  });
  document.getElementById("signupsRefresh").addEventListener("click", loadSignups);
}

async function loadLunchOrders() {
  try {
    const data = await api("/api/admin/lunch-sale/orders");
    lunchOrders = data.orders || [];
    renderLunchOrders();
    populateOrdersEventFilter();
  } catch (err) {
    showGlobalMsg("error", err.message);
  }
}

// This list is never scoped to "the current sale" — it's every lunch-sale
// order ever placed, oldest events included, so it doubles as the past
// orders view. The event dropdown + search box just narrow what's shown.
function getFilteredOrders() {
  const q = document.getElementById("ordersSearch").value.trim().toLowerCase();
  const eventId = document.getElementById("ordersEventFilter").value;
  return lunchOrders.filter((o) => {
    if (eventId && o.event_id !== eventId) return false;
    if (!q) return true;
    return [o.name, o.email, o.event_title].some((v) => String(v || "").toLowerCase().includes(q));
  });
}

function currentOrdersExportName() {
  const eventId = document.getElementById("ordersEventFilter").value;
  const ev = lunchEvents.find((e) => e.id === eventId);
  return ev
    ? `boxed-indulgence-${slugify(ev.title)}-${ev.sale_date}`
    : "boxed-indulgence-lunch-orders";
}

function renderLunchOrders() {
  const filtered = getFilteredOrders();
  const body = document.getElementById("ordersBody");
  if (!filtered.length) {
    body.innerHTML = `<tr><td colspan="7" class="subtle">No orders found.</td></tr>`;
    return;
  }
  body.innerHTML = filtered
    .map(
      (o) => `
    <tr>
      <td>${escapeHtml(o.event_title)}</td>
      <td>${escapeHtml(o.name)}</td>
      <td>${escapeHtml(o.email)}</td>
      <td>${escapeHtml(String(o.quantity))}</td>
      <td class="wrap-cell">${escapeHtml(o.dropoff_choice)}</td>
      <td>$${(o.total_cents / 100).toFixed(2)}</td>
      <td><span class="status-pill status-${escapeHtml(o.status)}">${escapeHtml(o.status.replace(/_/g, " "))}</span></td>
    </tr>`
    )
    .join("");
}

// ---- Excel (CSV) export -----------------------------------------------------
// No spreadsheet library is loaded on the site, so this writes a UTF-8 CSV
// with a BOM — Excel, Numbers, and Sheets all open that as a normal
// spreadsheet on double-click without any extra setup.

const ORDER_CSV_HEADERS = [
  "Event",
  "Sale Date",
  "Name",
  "Email",
  "Phone",
  "Qty",
  "Drop-off",
  "Total ($)",
  "Status",
  "Ordered At",
];

function orderToCsvRow(o) {
  return [
    o.event_title,
    o.event_sale_date,
    o.name,
    o.email,
    o.phone || "",
    o.quantity,
    o.dropoff_choice,
    (o.total_cents / 100).toFixed(2),
    o.status,
    formatDateTime(o.created_at),
  ];
}

function exportOrdersToExcel(orders, filenameBase) {
  if (!orders.length) {
    showGlobalMsg("error", "No orders to export.");
    return;
  }
  downloadCsv(`${filenameBase}.csv`, ORDER_CSV_HEADERS, orders.map(orderToCsvRow));
}

function exportEventOrders(eventId) {
  const ev = lunchEvents.find((e) => e.id === eventId);
  const orders = lunchOrders.filter((o) => o.event_id === eventId);
  const base = ev ? `boxed-indulgence-${slugify(ev.title)}-${ev.sale_date}` : `boxed-indulgence-event-${eventId}`;
  exportOrdersToExcel(orders, base);
}

function csvEscape(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(filename, headers, rows) {
  const lines = [headers.map(csvEscape).join(","), ...rows.map((row) => row.map(csvEscape).join(","))];
  // Leading BOM so Excel reads accented characters correctly on open.
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function slugify(s) {
  return (
    String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "event"
  );
}

async function loadSignups() {
  try {
    const data = await api("/api/admin/lunch-sale/signups");
    signups = data.signups || [];
    renderSignups();
  } catch (err) {
    showGlobalMsg("error", err.message);
  }
}

function renderSignups() {
  const body = document.getElementById("signupsBody");
  if (!signups.length) {
    body.innerHTML = `<tr><td colspan="2" class="subtle">No signups yet.</td></tr>`;
    return;
  }
  body.innerHTML = signups
    .map((s) => `<tr><td>${escapeHtml(s.email)}</td><td>${escapeHtml(formatDateTime(s.created_at))}</td></tr>`)
    .join("");
}

// ---- contacts ---------------------------------------------------------------

function wireContacts() {
  document.getElementById("contactsRefresh").addEventListener("click", loadContacts);
  document.getElementById("contactsSearch").addEventListener("input", renderContacts);
}

async function loadContacts() {
  try {
    const data = await api("/api/admin/contacts");
    contacts = data.contacts || [];
    renderContacts();
  } catch (err) {
    showGlobalMsg("error", err.message);
  }
}

function renderContacts() {
  const q = document.getElementById("contactsSearch").value.trim().toLowerCase();
  const filtered = q
    ? contacts.filter((c) =>
        [c.name, c.email, c.message].some((v) => String(v || "").toLowerCase().includes(q))
      )
    : contacts;

  const body = document.getElementById("contactsBody");
  if (!filtered.length) {
    body.innerHTML = `<tr><td colspan="5" class="subtle">No messages found.</td></tr>`;
    return;
  }
  body.innerHTML = filtered
    .map(
      (c) => `
    <tr>
      <td>${escapeHtml(c.name)}</td>
      <td>${escapeHtml(c.email)}</td>
      <td>${escapeHtml(c.phone || "—")}</td>
      <td>${escapeHtml(formatDateTime(c.created_at))}</td>
      <td class="wrap-cell">${escapeHtml(c.message || "—")}</td>
    </tr>`
    )
    .join("");
}

// ---- Google Calendar ----------------------------------------------------------

function wireCalendar() {
  document.getElementById("calSyncBtn").addEventListener("click", syncCalendarNow);
  document.getElementById("calDisconnectBtn").addEventListener("click", disconnectCalendar);
}

async function loadCalendarStatus() {
  try {
    const data = await api("/api/admin/google/status");
    const dot = document.getElementById("calDot");
    const text = document.getElementById("calStatusText");
    const connectBtn = document.getElementById("calConnectBtn");
    const syncBtn = document.getElementById("calSyncBtn");
    const disconnectBtn = document.getElementById("calDisconnectBtn");

    if (data.connected) {
      dot.classList.add("connected");
      text.textContent = `Connected as ${data.connected_email}${
        data.last_synced_at ? ` · last synced ${formatDateTime(data.last_synced_at)}` : ""
      }`;
      connectBtn.style.display = "none";
      syncBtn.style.display = "inline-flex";
      disconnectBtn.style.display = "inline-flex";
    } else {
      dot.classList.remove("connected");
      text.textContent = "Not connected.";
      connectBtn.style.display = "inline-flex";
      syncBtn.style.display = "none";
      disconnectBtn.style.display = "none";
    }
  } catch (err) {
    document.getElementById("calStatusText").textContent = "Could not check connection status.";
  }
}

async function syncCalendarNow() {
  const btn = document.getElementById("calSyncBtn");
  btn.disabled = true;
  btn.textContent = "Syncing…";
  try {
    await api("/api/admin/google/sync-now", { method: "POST" });
    showGlobalMsg("success", "Calendar synced.");
    loadCalendarStatus();
  } catch (err) {
    showGlobalMsg("error", err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Sync Now";
  }
}

async function disconnectCalendar() {
  if (!confirm("Disconnect Google Calendar? Two-way sync will stop until reconnected.")) return;
  try {
    await api("/api/admin/google/disconnect", { method: "POST" });
    showGlobalMsg("success", "Google Calendar disconnected.");
    loadCalendarStatus();
  } catch (err) {
    showGlobalMsg("error", err.message);
  }
}

// ---- blocked dates ------------------------------------------------------------

function wireBlockedDates() {
  document.getElementById("blockedForm").addEventListener("submit", onAddBlockedDate);
}

async function loadBlockedDates() {
  try {
    const data = await api("/api/admin/blocked-dates");
    blockedDates = data.blocked || [];
    renderBlockedDates();
    renderAdminCalendar();
  } catch (err) {
    showGlobalMsg("error", err.message);
  }
}

function renderBlockedDates() {
  const list = document.getElementById("blockedList");
  if (!blockedDates.length) {
    list.innerHTML = `<li class="subtle" style="border:none;">No blocked dates.</li>`;
    return;
  }
  list.innerHTML = blockedDates
    .map(
      (b) => `
    <li>
      <span>${escapeHtml(b.date)} — ${escapeHtml(b.reason || "No reason given")} ${
        b.source === "google_calendar" ? '<span class="subtle">(from calendar)</span>' : ""
      }</span>
      ${
        b.source !== "google_calendar"
          ? `<button class="btn btn-outline" data-unblock="${b.date}" style="padding:6px 12px;font-size:0.7rem;">Remove</button>`
          : ""
      }
    </li>`
    )
    .join("");

  list.querySelectorAll("[data-unblock]").forEach((btn) =>
    btn.addEventListener("click", () => removeBlockedDate(btn.dataset.unblock))
  );
}

async function onAddBlockedDate(e) {
  e.preventDefault();
  const date = document.getElementById("blockDate").value;
  const reason = document.getElementById("blockReason").value.trim();
  if (!date) return;
  try {
    await api("/api/admin/blocked-dates", { method: "POST", body: JSON.stringify({ date, reason }) });
    document.getElementById("blockedForm").reset();
    loadBlockedDates();
  } catch (err) {
    showGlobalMsg("error", err.message);
  }
}

async function removeBlockedDate(date) {
  try {
    await api(`/api/admin/blocked-dates/${encodeURIComponent(date)}`, { method: "DELETE" });
    loadBlockedDates();
  } catch (err) {
    showGlobalMsg("error", err.message);
  }
}

// ---- availability calendar (admin view) ------------------------------------
// Purely a client-side view over the bookings + blockedDates arrays already
// loaded elsewhere on this page — no separate API call, so it always reflects
// whatever's currently in memory and re-renders whenever either reloads.

const adminCal = { viewYear: null, viewMonth: null };

function wireAdminCalendar() {
  const today = new Date();
  adminCal.viewYear = today.getFullYear();
  adminCal.viewMonth = today.getMonth();
  document.getElementById("adminPrevMonth").addEventListener("click", () => shiftAdminCalendar(-1));
  document.getElementById("adminNextMonth").addEventListener("click", () => shiftAdminCalendar(1));
}

function shiftAdminCalendar(delta) {
  adminCal.viewMonth += delta;
  if (adminCal.viewMonth < 0) {
    adminCal.viewMonth = 11;
    adminCal.viewYear -= 1;
  }
  if (adminCal.viewMonth > 11) {
    adminCal.viewMonth = 0;
    adminCal.viewYear += 1;
  }
  renderAdminCalendar();
  document.getElementById("adminCalendarDetail").innerHTML = "";
}

function renderAdminCalendar() {
  const grid = document.getElementById("adminCalendarGrid");
  const label = document.getElementById("adminCalendarLabel");
  if (!grid || !label || adminCal.viewYear == null) return;

  label.textContent = new Date(adminCal.viewYear, adminCal.viewMonth, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  const bookingsByDate = new Map();
  bookings
    .filter((b) => ["pending_approval", "approved", "confirmed"].includes(b.status))
    .forEach((b) => {
      if (!bookingsByDate.has(b.event_date)) bookingsByDate.set(b.event_date, []);
      bookingsByDate.get(b.event_date).push(b);
    });

  const blockedByDate = new Map();
  blockedDates.forEach((b) => blockedByDate.set(b.date, b));

  grid.innerHTML = "";
  ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].forEach((d) => {
    const el = document.createElement("div");
    el.className = "dow";
    el.textContent = d;
    grid.appendChild(el);
  });

  const firstDay = new Date(adminCal.viewYear, adminCal.viewMonth, 1);
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(adminCal.viewYear, adminCal.viewMonth + 1, 0).getDate();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < startOffset; i++) {
    const el = document.createElement("div");
    el.className = "day empty";
    grid.appendChild(el);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateObj = new Date(adminCal.viewYear, adminCal.viewMonth, day);
    const dateStr = `${adminCal.viewYear}-${String(adminCal.viewMonth + 1).padStart(2, "0")}-${String(
      day
    ).padStart(2, "0")}`;

    const dayBookings = bookingsByDate.get(dateStr) || [];
    const blocked = blockedByDate.get(dateStr);

    let cls = "day";
    if (dateObj.getTime() === today.getTime()) cls += " today";
    if (dayBookings.length) {
      cls += " booked";
    } else if (blocked) {
      cls += blocked.source === "google_calendar" ? " blocked-cal" : " blocked";
    } else if (dateObj < today) {
      cls += " past";
    } else {
      cls += " available";
    }

    const el = document.createElement("div");
    el.className = cls;
    el.textContent = String(day);
    el.addEventListener("click", () => showAdminCalendarDetail(dateStr, dayBookings, blocked));
    grid.appendChild(el);
  }
}

function showAdminCalendarDetail(dateStr, dayBookings, blocked) {
  const el = document.getElementById("adminCalendarDetail");
  const niceDate = new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  if (dayBookings.length) {
    el.innerHTML = `<strong>${escapeHtml(niceDate)}</strong> — ${dayBookings
      .map((b) => `${escapeHtml(b.name)} (${escapeHtml(b.status.replace(/_/g, " "))})`)
      .join(", ")}`;
    return;
  }

  if (blocked) {
    const isGoogle = blocked.source === "google_calendar";
    el.innerHTML = `<strong>${escapeHtml(niceDate)}</strong> — Blocked${
      blocked.reason ? `: ${escapeHtml(blocked.reason)}` : ""
    }${isGoogle ? " (synced from Google Calendar)" : ""}${
      isGoogle
        ? ""
        : ` <button class="btn btn-outline" data-unblock-cal="${escapeHtml(
            blocked.date
          )}" style="padding:4px 10px;font-size:0.68rem;margin-left:8px;">Remove block</button>`
    }`;
    const btn = el.querySelector("[data-unblock-cal]");
    if (btn) btn.addEventListener("click", () => removeBlockedDate(btn.dataset.unblockCal));
    return;
  }

  el.innerHTML = `<strong>${escapeHtml(niceDate)}</strong> — Available.`;
}

// ---- shared helpers -----------------------------------------------------------

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

function formatDateTime(s) {
  if (!s) return "—";
  try {
    const d = new Date(s);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return s;
  }
}

// Date-only (no time) — used for the lunch-sale event picker, e.g. "Aug 25, 2026".
function formatShortDate(s) {
  if (!s) return "—";
  try {
    const d = new Date(`${s}T00:00:00`);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return s;
  }
}
