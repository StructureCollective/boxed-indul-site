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
let occasions = [];
let orderMenus = null;

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
  wireOccasions();
  wireMenus();
  wireDashboard();

  loadBookings();
  loadContacts();
  loadLunchEvents();
  loadLunchOrders();
  loadSignups();
  loadCalendarStatus();
  loadBlockedDates();
  renderAdminCalendar();
  loadOccasions();
  loadOrderMenus();

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
    renderDashboard();
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

const BOOKING_STATUS_LABELS = {
  pending_approval: "Pending Approval",
  approved: "Awaiting Deposit",
  rejected: "Rejected",
  confirmed: "Deposit Paid",
};

function bookingRow(b) {
  const total = b.order_total_cents != null ? `$${(b.order_total_cents / 100).toFixed(2)}` : "Quoted";
  const deposit = b.deposit_amount_cents != null ? `$${(b.deposit_amount_cents / 100).toFixed(2)}` : "—";
  const statusClass = `status-${b.status === "pending_approval" ? "pending" : b.status}`;
  const statusLabel = BOOKING_STATUS_LABELS[b.status] || b.status.replace(/_/g, " ");

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
      <td><span class="status-pill ${statusClass}">${escapeHtml(statusLabel)}</span></td>
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
  document.getElementById("showArchivedEvents").addEventListener("change", renderLunchEvents);
  document.getElementById("ev_template").addEventListener("change", onTemplateSelected);
}

// Keeps the "copy details from a previous sale" dropdown in sync with
// whatever events exist. Sorted most-recent sale first so the admin's most
// likely pick is at the top.
function populateTemplateEventSelect() {
  const sel = document.getElementById("ev_template");
  if (!sel) return;
  const current = sel.value;
  const sorted = [...lunchEvents].sort((a, b) => (b.sale_date || "").localeCompare(a.sale_date || ""));
  sel.innerHTML =
    `<option value="">— Start blank —</option>` +
    sorted
      .map(
        (ev) =>
          `<option value="${escapeHtml(ev.id)}">${escapeHtml(ev.title)} — ${escapeHtml(
            formatShortDate(ev.sale_date)
          )}</option>`
      )
      .join("");
  if (current && lunchEvents.some((ev) => ev.id === current)) sel.value = current;
}

// Autofills the New Lunch Sale Event form from a previously created event.
// Title, sale date, and cutoff are deliberately left untouched — the admin
// always supplies fresh ones, and onCreateLunchEvent always POSTs a new
// record (newId()), so this can never overwrite or merge into a prior sale's
// order history.
function onTemplateSelected() {
  const id = document.getElementById("ev_template").value;
  if (!id) return;
  const ev = lunchEvents.find((e) => e.id === id);
  if (!ev) return;

  document.getElementById("ev_menu").value = ev.menu_description || "";
  document.getElementById("ev_price").value =
    ev.price_cents != null ? (ev.price_cents / 100).toFixed(2) : "";
  document.getElementById("ev_slot_cap").value = ev.slot_cap ?? "";
  document.getElementById("ev_max_qty").value = ev.max_qty_per_order ?? "";
  document.getElementById("ev_image_url").value = ev.image_url || "";
  fillDropoffRows(parseOrderItems(ev.dropoff_options));

  showMsg(
    document.getElementById("lunchEventMsg"),
    "success",
    "Copied. Give this sale its own title, sale date, and cutoff below — it'll be saved as a brand-new event with its own order history."
  );
}

// Rebuilds the drop-off rows from a template event's saved drop-off list.
function fillDropoffRows(dropoffs) {
  const wrap = document.getElementById("dropoffRows");
  wrap.innerHTML = "";
  dropoffRowCount = 0;
  if (!dropoffs.length) {
    addDropoffRow();
    return;
  }
  dropoffs.forEach((d) => {
    addDropoffRow();
    const rows = wrap.querySelectorAll(".dropoff-row");
    const row = rows[rows.length - 1];
    row.querySelector(".dropoff-time").value = d.time || "";
    row.querySelector(".dropoff-location").value = d.location || "";
  });
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
    image_url: document.getElementById("ev_image_url").value.trim() || null,
    dropoff_options,
  };

  btn.disabled = true;
  btn.textContent = "Creating…";
  try {
    await api("/api/admin/lunch-sale/events", { method: "POST", body: JSON.stringify(payload) });
    showMsg(msgEl, "success", "Lunch sale event created.");
    document.getElementById("lunchEventForm").reset();
    document.getElementById("ev_image_url").value = "";
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
    populateTemplateEventSelect();
    renderDashboard();
  } catch (err) {
    showGlobalMsg("error", err.message);
  }
}

function renderLunchEvents() {
  const list = document.getElementById("eventsList");
  const showArchived = document.getElementById("showArchivedEvents")?.checked;
  const visible = showArchived ? lunchEvents : lunchEvents.filter((ev) => !ev.archived);
  const archivedCount = lunchEvents.length - lunchEvents.filter((ev) => !ev.archived).length;

  if (!lunchEvents.length) {
    list.innerHTML = `<p class="subtle">No lunch sale events yet — create one above.</p>`;
    return;
  }
  if (!visible.length) {
    list.innerHTML = `<p class="subtle">All events are archived. Check "Show archived" above to see them.</p>`;
    return;
  }

  list.innerHTML =
    visible.map(eventCard).join("") +
    (!showArchived && archivedCount
      ? `<p class="subtle">${archivedCount} archived event${archivedCount === 1 ? "" : "s"} hidden — check "Show archived" above to see them.</p>`
      : "");

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
  list.querySelectorAll("[data-archive-event]").forEach((btn) =>
    btn.addEventListener("click", () => setEventArchived(btn.dataset.archiveEvent, true))
  );
  list.querySelectorAll("[data-unarchive-event]").forEach((btn) =>
    btn.addEventListener("click", () => setEventArchived(btn.dataset.unarchiveEvent, false))
  );
  list.querySelectorAll("[data-toggle-extend]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const row = btn.closest(".event-card")?.querySelector(".extend-cutoff-row");
      if (row) row.style.display = row.style.display === "none" ? "flex" : "none";
    })
  );
  list.querySelectorAll("[data-extend-cutoff]").forEach((btn) =>
    btn.addEventListener("click", () => extendCutoff(btn.dataset.extendCutoff))
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
  // "live" in the DB just means the admin hasn't closed/canceled it — it
  // doesn't mean orders are still being accepted right now. Once the cutoff
  // passes, treat it as visually "ended" even though status is still "live",
  // so the admin isn't misled into thinking it's still orderable.
  const cutoffPassed = new Date(ev.order_cutoff_at).getTime() < Date.now();
  const isEnded = ev.status === "live" && cutoffPassed;

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
  if (!ev.archived && (ev.status === "live" || ev.status === "closed")) {
    actions += `<button class="btn btn-outline" data-toggle-extend="${ev.id}">Extend Cutoff</button>`;
  }
  if (ev.archived) {
    actions += `<button class="btn btn-outline" data-unarchive-event="${ev.id}">Unarchive</button>`;
  } else if (ev.status !== "live") {
    // Archiving hides a done sale from the default list without touching
    // its orders — the alternative to Delete, which is blocked once real
    // orders exist (see the "Can't delete" error from the API).
    actions += `<button class="btn btn-outline" data-archive-event="${ev.id}">Archive</button>`;
  }
  actions += `<button class="btn btn-outline" data-delete-event="${ev.id}" style="border-color:var(--maroon);color:var(--maroon);">Delete</button>`;

  const thumb = ev.image_url ? `<img src="${escapeHtml(ev.image_url)}" alt="" class="thumb">` : "";

  const statusPill = isEnded
    ? `<span class="status-pill status-ended">ended</span>`
    : ev.status === "live"
    ? `<span class="status-pill status-live-flash">live</span>`
    : `<span class="status-pill status-${escapeHtml(ev.status)}">${escapeHtml(ev.status)}</span>`;

  const extendRow =
    !ev.archived && (ev.status === "live" || ev.status === "closed")
      ? `
      <div class="extend-cutoff-row" data-event-id="${ev.id}" style="display:none;margin-top:10px;padding-top:10px;border-top:1px dashed var(--line);gap:8px;align-items:center;flex-wrap:wrap;">
        <label style="font-size:0.72rem;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:0.04em;">New cutoff</label>
        <input type="datetime-local" class="extend-cutoff-input" style="padding:6px 8px;border:1px solid var(--line);border-radius:6px;font-size:0.8rem;">
        <button type="button" class="btn btn-primary" data-extend-cutoff="${ev.id}" style="padding:6px 12px;font-size:0.7rem;">Save New Cutoff</button>
      </div>`
      : "";

  return `
    <div class="event-card${ev.archived ? " archived" : ""}">
      ${thumb}
      <div class="top">
        <strong>${escapeHtml(ev.title)}</strong>
        <span style="display:flex;gap:6px;">
          ${ev.archived ? `<span class="status-pill status-closed">archived</span>` : ""}
          ${ev.cutoff_extended ? `<span class="status-pill status-extended">cutoff extended</span>` : ""}
          ${statusPill}
        </span>
      </div>
      <p class="subtle" style="margin-bottom:6px;">${escapeHtml(ev.menu_description)}</p>
      <p class="subtle" style="margin-bottom:6px;">
        For ${escapeHtml(ev.sale_date)} · $${(ev.price_cents / 100).toFixed(2)}/lunch ·
        cap ${escapeHtml(String(ev.slot_cap))} lunches · cutoff ${escapeHtml(formatDateTime(ev.order_cutoff_at))}
      </p>
      <p class="subtle" style="margin-bottom:0;">Drop-off: ${escapeHtml(dropoffText)}</p>
      <div class="actions">${actions}</div>
      ${extendRow}
    </div>`;
}

// Pushes an event's order cutoff later (optionally reopening a "closed"
// event) and flags cutoff_extended so the public site shows the "cutoff
// extended" banner while this stays the current sale.
async function extendCutoff(id) {
  const row = document.querySelector(`.extend-cutoff-row[data-event-id="${id}"]`);
  const input = row?.querySelector(".extend-cutoff-input");
  if (!input || !input.value) {
    showGlobalMsg("error", "Pick a new cutoff date & time first.");
    return;
  }
  const ev = lunchEvents.find((e) => e.id === id);
  const body = { order_cutoff_at: new Date(input.value).toISOString(), cutoff_extended: true };
  if (ev && ev.status === "closed") body.status = "live";
  try {
    await api(`/api/admin/lunch-sale/events/${id}`, { method: "PATCH", body: JSON.stringify(body) });
    showGlobalMsg("success", "Cutoff extended — the site will show a cutoff-extended banner while this sale is live.");
    loadLunchEvents();
  } catch (err) {
    showGlobalMsg("error", err.message);
  }
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

async function setEventArchived(id, archived) {
  try {
    await api(`/api/admin/lunch-sale/events/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ archived }),
    });
    showGlobalMsg("success", archived ? "Event archived." : "Event unarchived.");
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
    renderDashboard();
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
    body.innerHTML = `<tr><td colspan="8" class="subtle">No orders found.</td></tr>`;
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
      <td><div class="row-actions">${
        o.status === "pending_payment"
          ? `<button class="btn btn-outline" data-resend-payment="${o.id}">Resend Payment Link</button>`
          : ""
      }</div></td>
    </tr>`
    )
    .join("");

  body.querySelectorAll("[data-resend-payment]").forEach((btn) =>
    btn.addEventListener("click", () => resendPaymentLink(btn.dataset.resendPayment))
  );
}

async function resendPaymentLink(id) {
  try {
    await api(`/api/admin/lunch-sale/orders/${id}/resend-payment-link`, { method: "POST" });
    showGlobalMsg("success", "Payment link resent to the customer.");
  } catch (err) {
    showGlobalMsg("error", err.message);
  }
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

// ---- dashboard ---------------------------------------------------------------
// Pure read/derive from data already loaded for the other tabs (bookings,
// lunchEvents, lunchOrders) — no extra API calls. Called again whenever any
// of those reload, so it stays current without its own refresh button.

function renderDashboard() {
  renderDashboardLunchSale();
  renderDashboardOrders();
}

function wireDashboard() {
  document.getElementById("dashOrdersRange")?.addEventListener("change", renderDashboardOrders);
}

function switchAdminTab(panelId) {
  document.querySelector(`.admin-tabs button[data-panel="${panelId}"]`)?.click();
}

// Start-of-range cutoff for the Custom Orders Overview date filter, keyed
// off each booking's created_at (when the request came in) — null means no
// filter ("All Time"). Week/Month/Year are calendar-aligned (e.g. "This
// Month" = since the 1st), 30days is a rolling window.
function dashOrdersRangeStart(rangeKey) {
  const now = new Date();
  if (rangeKey === "week") {
    const start = new Date(now);
    start.setDate(start.getDate() - start.getDay());
    start.setHours(0, 0, 0, 0);
    return start;
  }
  if (rangeKey === "month") {
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }
  if (rangeKey === "30days") {
    return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }
  if (rangeKey === "year") {
    return new Date(now.getFullYear(), 0, 1);
  }
  return null; // "all"
}

function renderDashboardLunchSale() {
  const el = document.getElementById("dashLunchSale");
  if (!el) return;

  const live = lunchEvents
    .filter((ev) => ev.status === "live")
    .sort((a, b) => new Date(a.sale_date) - new Date(b.sale_date))[0];

  if (!live) {
    el.innerHTML = `<p class="subtle">No live lunch sale right now — create or activate one from the Lunch Sale tab.</p>`;
    return;
  }

  const orders = lunchOrders.filter((o) => o.event_id === live.id);
  const paid = orders.filter((o) => o.status === "paid");
  const paidQty = paid.reduce((sum, o) => sum + (o.quantity || 0), 0);
  const paidTotal = paid.reduce((sum, o) => sum + (o.total_cents || 0), 0);
  const dropoffs =
    parseOrderItems(live.dropoff_options)
      .map((d) => `${d.time} — ${d.location}`)
      .join(" · ") || "—";
  const cutoffPassed = new Date(live.order_cutoff_at).getTime() < Date.now();

  el.innerHTML = `
    <div class="dash-stats">
      <div class="dash-stat"><span class="num">${escapeHtml(String(live.slot_cap))}</span><span class="label">Lunch Cap</span></div>
      <div class="dash-stat"><span class="num">$${(live.price_cents / 100).toFixed(2)}</span><span class="label">Price / Lunch</span></div>
      <div class="dash-stat"><span class="num">${paidQty}/${live.slot_cap}</span><span class="label">Lunches Paid</span></div>
      <div class="dash-stat"><span class="num">$${(paidTotal / 100).toFixed(2)}</span><span class="label">Payments Received</span></div>
    </div>
    <p style="margin:14px 0 4px;"><strong>${escapeHtml(live.title)}</strong> ${
    cutoffPassed
      ? `<span class="status-pill status-ended">ended</span>`
      : `<span class="status-pill status-live-flash">live</span>`
  }</p>
    <p class="subtle" style="margin-bottom:4px;">For ${escapeHtml(formatShortDate(live.sale_date))} · cutoff ${escapeHtml(
    formatDateTime(live.order_cutoff_at)
  )}</p>
    <p class="subtle" style="margin-bottom:0;">Drop-off: ${escapeHtml(dropoffs)}</p>
    <button type="button" class="btn btn-outline" style="margin-top:14px;padding:8px 16px;font-size:0.72rem;" data-goto-lunch>View in Lunch Sale tab</button>`;

  el.querySelector("[data-goto-lunch]")?.addEventListener("click", () => switchAdminTab("panel-lunch"));
}

function renderDashboardOrders() {
  const el = document.getElementById("dashOrders");
  if (!el) return;

  const rangeKey = document.getElementById("dashOrdersRange")?.value || "30days";
  const start = dashOrdersRangeStart(rangeKey);
  const inRange = start ? bookings.filter((b) => new Date(b.created_at) >= start) : bookings;

  const pending = inRange.filter((b) => b.status === "pending_approval");
  const awaiting = inRange.filter((b) => b.status === "approved");
  const confirmed = inRange.filter((b) => b.status === "confirmed");
  const depositTotal = confirmed.reduce((sum, b) => sum + (b.deposit_amount_cents || 0), 0);

  const pendingList = pending
    .slice(0, 5)
    .map((b) => `<li><span>${escapeHtml(b.name)}</span><span class="subtle">${escapeHtml(b.event_date)}</span></li>`)
    .join("");

  el.innerHTML = `
    <div class="dash-stats">
      <div class="dash-stat"><span class="num">${pending.length}</span><span class="label">Pending Requests</span></div>
      <div class="dash-stat"><span class="num">${awaiting.length}</span><span class="label">Awaiting Deposit</span></div>
      <div class="dash-stat"><span class="num">${confirmed.length}</span><span class="label">Deposits Paid</span></div>
      <div class="dash-stat"><span class="num">$${(depositTotal / 100).toFixed(2)}</span><span class="label">Deposits Collected</span></div>
    </div>
    ${
      pending.length
        ? `<p class="row-label" style="margin-top:14px;">Pending requests</p><ul class="dash-list">${pendingList}</ul>${
            pending.length > 5 ? `<p class="subtle">+${pending.length - 5} more.</p>` : ""
          }`
        : `<p class="subtle" style="margin-top:14px;">No pending requests.</p>`
    }
    <button type="button" class="btn btn-outline" style="margin-top:10px;padding:8px 16px;font-size:0.72rem;" data-goto-bookings>View in Custom Orders tab</button>`;

  el.querySelector("[data-goto-bookings]")?.addEventListener("click", () => switchAdminTab("panel-bookings"));
}

// ---- occasions (Menus tab) --------------------------------------------------
// Admin-editable list of Occasion options shown on the Custom Order form.
// Backed by the D1 site_settings table (see src/lib/menu-data.js), so
// changes here apply immediately with no redeploy.

function wireOccasions() {
  document.getElementById("occasionsAdd").addEventListener("click", () => {
    occasions.push({ value: "", label: "" });
    renderOccasions();
  });
  document.getElementById("occasionsSave").addEventListener("click", saveOccasions);
}

async function loadOccasions() {
  try {
    const data = await api("/api/admin/occasions");
    occasions = data.occasions || [];
    renderOccasions();
  } catch (err) {
    showGlobalMsg("error", err.message);
  }
}

function renderOccasions() {
  const wrap = document.getElementById("occasionsRows");
  wrap.innerHTML =
    occasions
      .map(
        (o, i) => `
    <div class="menu-item-row occasion-row">
      <div><span class="row-label">Value (internal)</span><input type="text" class="occ-value" data-idx="${i}" value="${escapeHtml(
          o.value
        )}" placeholder="e.g. corporate"></div>
      <div><span class="row-label">Label (shown to customers)</span><input type="text" class="occ-label" data-idx="${i}" value="${escapeHtml(
          o.label
        )}" placeholder="e.g. Corporate Catering"></div>
      <button type="button" class="btn btn-outline remove-item" data-remove-occ="${i}">Remove</button>
    </div>`
      )
      .join("") || `<p class="subtle">No occasions yet — add one above.</p>`;

  wrap.querySelectorAll(".occ-value").forEach((el) =>
    el.addEventListener("input", () => {
      occasions[Number(el.dataset.idx)].value = el.value;
    })
  );
  wrap.querySelectorAll(".occ-label").forEach((el) =>
    el.addEventListener("input", () => {
      occasions[Number(el.dataset.idx)].label = el.value;
    })
  );
  wrap.querySelectorAll("[data-remove-occ]").forEach((btn) =>
    btn.addEventListener("click", () => {
      occasions.splice(Number(btn.dataset.removeOcc), 1);
      renderOccasions();
    })
  );
}

async function saveOccasions() {
  const msgEl = document.getElementById("occasionsMsg");
  const cleaned = occasions
    .map((o) => ({ value: (o.value || "").trim(), label: (o.label || "").trim() }))
    .filter((o) => o.value && o.label);

  if (!cleaned.length) {
    showMsg(msgEl, "error", "Add at least one occasion with a value and label.");
    return;
  }
  const values = cleaned.map((o) => o.value);
  if (new Set(values).size !== values.length) {
    showMsg(msgEl, "error", "Occasion values must be unique.");
    return;
  }

  try {
    await api("/api/admin/occasions", { method: "PUT", body: JSON.stringify({ occasions: cleaned }) });
    occasions = cleaned;
    renderOccasions();
    showMsg(msgEl, "success", "Occasions saved.");
  } catch (err) {
    showMsg(msgEl, "error", err.message);
  }
}

// ---- order menus (Menus tab) -------------------------------------------------
// Admin-editable Boxed Lunch / Charcuterie / Custom Meal item catalog —
// same D1-backed storage as occasions. This is the pricing engine for both
// the /booking/ order form and the server-side price validation, so blank
// rows are dropped and prices/ids are normalized before saving.

const MENU_LIST_CONFIG = {
  boxed_lunch: {
    entrees: { quoted: false, label: "Entrées", singular: "Entrée" },
    enhancements: { quoted: false, label: "Enhancements", singular: "Enhancement" },
  },
  charcuterie: {
    boards: { quoted: false, label: "Boards", singular: "Board" },
    enhancements: { quoted: false, label: "Enhancements", singular: "Enhancement" },
  },
  custom_meal: {
    boxes: { quoted: false, label: "Box Collections", singular: "Box" },
    personalization: { quoted: true, label: "Personalization", singular: "Option" },
  },
};

const MENU_CATEGORY_LABELS = {
  boxed_lunch: "Boxed Lunch",
  charcuterie: "Charcuterie Board",
  custom_meal: "Custom Boxed Meal",
};

// Which item the popup editor currently has open — { cat, listKey, idx }.
// idx is null while creating a new item, otherwise the index being edited.
let miState = { cat: null, listKey: null, idx: null };

function wireMenus() {
  document.querySelectorAll("[data-add-item]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const [cat, listKey] = btn.dataset.addItem.split(".");
      openMenuItemModal(cat, listKey, null);
    })
  );
  document.querySelectorAll("[data-edit-existing]").forEach((btn) =>
    btn.addEventListener("click", () => openMenuItemModal(btn.dataset.editExisting, null, null))
  );
  document.getElementById("menusSave").addEventListener("click", saveOrderMenus);
  document.getElementById("menuItemModalClose").addEventListener("click", closeMenuItemModal);
  document.getElementById("menuItemModal").addEventListener("click", (e) => {
    if (e.target.id === "menuItemModal") closeMenuItemModal();
  });
  document.getElementById("miSelect").addEventListener("change", onMiSelectChange);
  document.getElementById("miSave").addEventListener("click", saveMenuItem);
  document.getElementById("miDelete").addEventListener("click", deleteMenuItem);
  Object.keys(MENU_LIST_CONFIG).forEach((cat) => {
    document.getElementById(`note_${cat}`).addEventListener("input", (e) => {
      if (!orderMenus) return;
      if (!orderMenus[cat]) orderMenus[cat] = {};
      orderMenus[cat].note = e.target.value;
    });
  });
}

async function loadOrderMenus() {
  try {
    const data = await api("/api/admin/order-menus");
    orderMenus = data.order_menus || {};
    renderOrderMenus();
  } catch (err) {
    showGlobalMsg("error", err.message);
  }
}

function renderOrderMenus() {
  if (!orderMenus) return;
  document.getElementById("menusLoadingMsg").style.display = "none";
  document.getElementById("menuCategories").style.display = "block";

  for (const [cat, lists] of Object.entries(MENU_LIST_CONFIG)) {
    if (!orderMenus[cat]) orderMenus[cat] = {};
    const menu = orderMenus[cat];
    const noteEl = document.getElementById(`note_${cat}`);
    if (noteEl) noteEl.value = menu.note || "";
    for (const listKey of Object.keys(lists)) {
      if (!Array.isArray(menu[listKey])) menu[listKey] = [];
      renderItemList(cat, listKey);
    }
  }
}

// Compact read-only list — clicking a row opens the popup editor pre-loaded
// with that item. Editing itself always happens inside the popup now.
function renderItemList(cat, listKey) {
  const wrap = document.getElementById(`items_${cat}_${listKey}`);
  if (!wrap) return;
  const items = orderMenus[cat][listKey];
  const quoted = MENU_LIST_CONFIG[cat][listKey].quoted;

  if (!items.length) {
    wrap.innerHTML = `<p class="mi-empty">No items yet — use + Add above.</p>`;
    return;
  }

  wrap.innerHTML = items
    .map(
      (item, i) => `
    <button type="button" class="mi-row" data-open-item="${cat}.${listKey}.${i}">
      <span class="mi-name">${escapeHtml(item.name || "(untitled)")}</span>
      <span class="mi-price">${
        quoted
          ? "custom quote"
          : `$${((item.price_cents || 0) / 100).toFixed(2)}${item.per_guest ? "/guest" : ""}`
      }</span>
    </button>`
    )
    .join("");

  wrap.querySelectorAll("[data-open-item]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const [c, l, idx] = btn.dataset.openItem.split(".");
      openMenuItemModal(c, l, Number(idx));
    })
  );
}

// ---- popup item editor (used by both "+ Add X" and "Edit Existing Menu") ----

function openMenuItemModal(cat, listKey, idx) {
  miState = { cat, listKey: listKey || null, idx: idx ?? null };
  const select = document.getElementById("miSelect");
  select.innerHTML = buildMiSelectOptions(cat);

  if (idx != null && listKey) {
    select.value = `edit:${listKey}:${idx}`;
  } else if (listKey) {
    select.value = `new:${listKey}`;
  } else {
    // Opened via "Edit Existing Menu" with no specific item — default to
    // the first existing item in this category, or the first "add new"
    // slot if the category has nothing in it yet.
    const firstExisting = select.querySelector('option[value^="edit:"]');
    select.value = firstExisting ? firstExisting.value : select.options[0]?.value;
  }

  document.getElementById("menuItemModalTitle").textContent = `${MENU_CATEGORY_LABELS[cat]} Menu`;
  document.getElementById("menuItemModal").style.display = "flex";
  onMiSelectChange();
}

function buildMiSelectOptions(cat) {
  let html = "";
  for (const [listKey, cfg] of Object.entries(MENU_LIST_CONFIG[cat])) {
    const items = orderMenus?.[cat]?.[listKey] || [];
    html += `<optgroup label="${escapeHtml(cfg.label)}">`;
    html += `<option value="new:${listKey}">+ Add new ${escapeHtml(cfg.singular)}</option>`;
    items.forEach((item, i) => {
      html += `<option value="edit:${listKey}:${i}">${escapeHtml(item.name || "(untitled)")}</option>`;
    });
    html += `</optgroup>`;
  }
  return html;
}

function onMiSelectChange() {
  const select = document.getElementById("miSelect");
  const [mode, listKey, idxStr] = select.value.split(":");
  miState.listKey = listKey;
  miState.idx = mode === "edit" ? Number(idxStr) : null;

  const quoted = MENU_LIST_CONFIG[miState.cat][listKey].quoted;
  const item = mode === "edit" ? orderMenus[miState.cat][listKey][miState.idx] : null;

  document.getElementById("mi_name").value = item?.name || "";
  document.getElementById("mi_desc").value = item?.description || "";
  document.getElementById("mi_price").value = item ? ((item.price_cents || 0) / 100).toFixed(2) : "";
  document.getElementById("mi_perguest").checked = !!item?.per_guest;
  document.getElementById("mi_image").value = item?.image_url || "";

  document.getElementById("miPriceRow").style.display = quoted ? "none" : "grid";
  document.getElementById("miDelete").style.display = mode === "edit" ? "inline-flex" : "none";
  document.getElementById("miMsg").className = "form-msg";
  document.getElementById("miFields").style.display = "block";
}

function closeMenuItemModal() {
  document.getElementById("menuItemModal").style.display = "none";
}

function saveMenuItem() {
  const msgEl = document.getElementById("miMsg");
  const { cat, listKey, idx } = miState;
  const name = document.getElementById("mi_name").value.trim();
  if (!name) {
    showMsg(msgEl, "error", "Name is required.");
    return;
  }

  const quoted = MENU_LIST_CONFIG[cat][listKey].quoted;
  const existing = idx != null ? orderMenus[cat][listKey][idx] : null;
  const item = {
    id: existing?.id || "",
    name,
    description: document.getElementById("mi_desc").value.trim(),
  };
  if (quoted) {
    item.quoted = true;
  } else {
    item.price_cents = Math.round((Number(document.getElementById("mi_price").value) || 0) * 100);
    item.per_guest = document.getElementById("mi_perguest").checked;
    const image = document.getElementById("mi_image").value.trim();
    if (image) item.image_url = image;
  }

  if (idx != null) {
    orderMenus[cat][listKey][idx] = item;
  } else {
    orderMenus[cat][listKey].push(item);
  }

  renderItemList(cat, listKey);
  closeMenuItemModal();
  showGlobalMsg("success", `"${name}" saved — click "Save All Menus" below to publish it.`);
}

function deleteMenuItem() {
  const { cat, listKey, idx } = miState;
  if (idx == null) return;
  const item = orderMenus[cat][listKey][idx];
  if (!confirm(`Remove "${item?.name || "this item"}" from the menu?`)) return;

  orderMenus[cat][listKey].splice(idx, 1);
  renderItemList(cat, listKey);
  closeMenuItemModal();
  showGlobalMsg("success", `Removed — click "Save All Menus" below to publish it.`);
}

async function saveOrderMenus() {
  const msgEl = document.getElementById("menusMsg");
  if (!orderMenus) return;

  // Auto-slug any blank IDs from the item name, and de-dupe collisions —
  // saves the admin from hand-typing unique ids for every item.
  for (const [cat, lists] of Object.entries(MENU_LIST_CONFIG)) {
    for (const listKey of Object.keys(lists)) {
      const items = orderMenus[cat]?.[listKey] || [];
      const seen = new Set();
      for (const item of items) {
        if (!item.id || !item.id.trim()) item.id = slugify(item.name);
        let id = item.id;
        let n = 2;
        while (seen.has(id)) {
          id = `${item.id}-${n}`;
          n += 1;
        }
        item.id = id;
        seen.add(id);
      }
    }
  }

  // Drop rows the admin left blank (no name) and normalize the shape the
  // server expects before saving — it re-validates on the way in too.
  const cleaned = {};
  for (const [cat, lists] of Object.entries(MENU_LIST_CONFIG)) {
    cleaned[cat] = { label: orderMenus[cat]?.label || cat, note: orderMenus[cat]?.note || "" };
    for (const [listKey, { quoted }] of Object.entries(lists)) {
      cleaned[cat][listKey] = (orderMenus[cat]?.[listKey] || [])
        .filter((item) => item.name && item.name.trim())
        .map((item) =>
          quoted
            ? { id: item.id, name: item.name.trim(), description: (item.description || "").trim(), quoted: true }
            : {
                id: item.id,
                name: item.name.trim(),
                description: (item.description || "").trim(),
                price_cents: item.price_cents || 0,
                per_guest: !!item.per_guest,
                ...(item.image_url && item.image_url.trim() ? { image_url: item.image_url.trim() } : {}),
              }
        );
    }
  }

  try {
    await api("/api/admin/order-menus", { method: "PUT", body: JSON.stringify({ order_menus: cleaned }) });
    orderMenus = cleaned;
    renderOrderMenus();
    showMsg(msgEl, "success", "Menus saved.");
  } catch (err) {
    showMsg(msgEl, "error", err.message);
  }
}
