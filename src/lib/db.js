// ---- custom-order bookings ----------------------------------------------

export async function getBooking(env, id) {
  return env.DB.prepare("SELECT * FROM bookings WHERE id = ?").bind(id).first();
}

export async function insertBooking(env, booking) {
  await env.DB.prepare(
    `INSERT INTO bookings
      (id, name, email, phone, event_type, event_date, guest_count, location, budget, notes,
       menu_type, order_items, order_total_cents,
       status, deposit_percent, deposit_amount_cents, stripe_payment_status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      booking.id,
      booking.name,
      booking.email,
      booking.phone || null,
      booking.event_type,
      booking.event_date,
      booking.guest_count,
      booking.location || null,
      booking.budget || null,
      booking.notes || null,
      booking.menu_type || null,
      booking.order_items ? JSON.stringify(booking.order_items) : null,
      booking.order_total_cents ?? null,
      booking.status,
      booking.deposit_percent ?? null,
      booking.deposit_amount_cents,
      "unpaid",
      booking.created_at,
      booking.updated_at
    )
    .run();
}

export async function updateBookingStatus(env, id, status, extra = {}) {
  const fields = ["status = ?", "updated_at = ?"];
  const values = [status, new Date().toISOString()];
  for (const [k, v] of Object.entries(extra)) {
    fields.push(`${k} = ?`);
    values.push(v);
  }
  values.push(id);
  await env.DB.prepare(`UPDATE bookings SET ${fields.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();
}

export async function listPendingBookings(env) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM bookings WHERE status = 'pending_approval' ORDER BY event_date ASC"
  ).all();
  return results;
}

// Every booking, most recent first — the admin "All Orders" searchable table.
export async function listAllBookings(env) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM bookings ORDER BY created_at DESC"
  ).all();
  return results;
}

export async function listBookedDatesInRange(env, startDate, endDate) {
  const { results } = await env.DB.prepare(
    `SELECT event_date FROM bookings
     WHERE status IN ('pending_approval','approved','confirmed')
       AND event_date BETWEEN ? AND ?`
  )
    .bind(startDate, endDate)
    .all();
  return results.map((r) => r.event_date);
}

export async function listBlockedDatesInRange(env, startDate, endDate) {
  const { results } = await env.DB.prepare(
    "SELECT date, reason, source FROM blocked_dates WHERE date BETWEEN ? AND ?"
  )
    .bind(startDate, endDate)
    .all();
  return results;
}

export async function findBookingByStripeSession(env, sessionId) {
  return env.DB.prepare(
    "SELECT * FROM bookings WHERE stripe_checkout_session_id = ?"
  )
    .bind(sessionId)
    .first();
}

// ---- contact messages ----------------------------------------------------

export async function insertContactMessage(env, msg) {
  await env.DB.prepare(
    `INSERT INTO contact_messages
      (id, name, email, phone, guest_count, event_date, location, budget, message, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      msg.id,
      msg.name,
      msg.email,
      msg.phone || null,
      msg.guest_count || null,
      msg.event_date || null,
      msg.location || null,
      msg.budget || null,
      msg.message || null,
      msg.created_at
    )
    .run();
}

export async function listAllContactMessages(env) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM contact_messages ORDER BY created_at DESC"
  ).all();
  return results;
}

// ---- lunch-sale events ----------------------------------------------------

export async function insertLunchSaleEvent(env, ev) {
  await env.DB.prepare(
    `INSERT INTO lunch_sale_events
      (id, title, menu_description, price_cents, dropoff_options, sale_date,
       order_cutoff_at, slot_cap, max_qty_per_order, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      ev.id,
      ev.title,
      ev.menu_description,
      ev.price_cents,
      JSON.stringify(ev.dropoff_options),
      ev.sale_date,
      ev.order_cutoff_at,
      ev.slot_cap,
      ev.max_qty_per_order || 10,
      ev.status || "draft",
      ev.created_at,
      ev.updated_at
    )
    .run();
}

export async function updateLunchSaleEvent(env, id, fields) {
  const sets = [];
  const values = [];
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`);
    values.push(k === "dropoff_options" && typeof v !== "string" ? JSON.stringify(v) : v);
  }
  sets.push("updated_at = ?");
  values.push(new Date().toISOString());
  values.push(id);
  await env.DB.prepare(`UPDATE lunch_sale_events SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();
}

export async function getLunchSaleEvent(env, id) {
  return env.DB.prepare("SELECT * FROM lunch_sale_events WHERE id = ?").bind(id).first();
}

// The one event customers should see right now: live status, cutoff not
// passed yet, and still has open order slots.
export async function getCurrentLiveLunchSaleEvent(env) {
  const nowIso = new Date().toISOString();
  const event = await env.DB.prepare(
    `SELECT * FROM lunch_sale_events
     WHERE status = 'live' AND order_cutoff_at > ?
     ORDER BY sale_date ASC LIMIT 1`
  )
    .bind(nowIso)
    .first();
  if (!event) return null;

  const { count } = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM lunch_sale_orders
     WHERE event_id = ? AND status IN ('pending_payment','paid')`
  )
    .bind(event.id)
    .first();

  return { ...event, slots_used: count, slots_remaining: Math.max(0, event.slot_cap - count) };
}

export async function listAllLunchSaleEvents(env) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM lunch_sale_events ORDER BY sale_date DESC"
  ).all();
  return results;
}

// ---- lunch-sale orders ----------------------------------------------------

export async function insertLunchSaleOrder(env, order) {
  await env.DB.prepare(
    `INSERT INTO lunch_sale_orders
      (id, event_id, name, email, phone, quantity, dropoff_choice, total_cents,
       status, stripe_payment_status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      order.id,
      order.event_id,
      order.name,
      order.email,
      order.phone || null,
      order.quantity,
      order.dropoff_choice,
      order.total_cents,
      order.status || "pending_payment",
      "unpaid",
      order.created_at,
      order.updated_at
    )
    .run();
}

export async function updateLunchSaleOrderStatus(env, id, status, extra = {}) {
  const fields = ["status = ?", "updated_at = ?"];
  const values = [status, new Date().toISOString()];
  for (const [k, v] of Object.entries(extra)) {
    fields.push(`${k} = ?`);
    values.push(v);
  }
  values.push(id);
  await env.DB.prepare(`UPDATE lunch_sale_orders SET ${fields.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();
}

export async function getLunchSaleOrder(env, id) {
  return env.DB.prepare("SELECT * FROM lunch_sale_orders WHERE id = ?").bind(id).first();
}

export async function findLunchSaleOrderByStripeSession(env, sessionId) {
  return env.DB.prepare(
    "SELECT * FROM lunch_sale_orders WHERE stripe_checkout_session_id = ?"
  )
    .bind(sessionId)
    .first();
}

// Counts confirmed/pending slots for an event — used at order time to
// enforce the cap atomically-ish (see index.js for the D1 transaction note).
export async function countActiveLunchSaleOrders(env, eventId) {
  const { count } = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM lunch_sale_orders
     WHERE event_id = ? AND status IN ('pending_payment','paid')`
  )
    .bind(eventId)
    .first();
  return count;
}

export async function listAllLunchSaleOrders(env) {
  const { results } = await env.DB.prepare(
    `SELECT o.*, e.title as event_title, e.sale_date as event_sale_date
     FROM lunch_sale_orders o
     JOIN lunch_sale_events e ON e.id = o.event_id
     ORDER BY o.created_at DESC`
  ).all();
  return results;
}

// ---- lunch-sale "notify me" signups ---------------------------------------

export async function insertLunchSaleSignup(env, signup) {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO lunch_sale_signups (id, email, created_at) VALUES (?,?,?)"
  )
    .bind(signup.id, signup.email, signup.created_at)
    .run();
}

export async function listLunchSaleSignups(env) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM lunch_sale_signups ORDER BY created_at DESC"
  ).all();
  return results;
}

// ---- Google Calendar connection --------------------------------------------

export async function saveGoogleCalendarConnection(env, { refreshToken, connectedEmail, calendarId }) {
  await env.DB.prepare(
    `INSERT INTO google_calendar_connection (id, connected_email, refresh_token, calendar_id, updated_at)
     VALUES ('default', ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       connected_email = excluded.connected_email,
       refresh_token = excluded.refresh_token,
       calendar_id = excluded.calendar_id,
       updated_at = excluded.updated_at`
  )
    .bind(connectedEmail, refreshToken, calendarId || "primary", new Date().toISOString())
    .run();
}

export async function getGoogleCalendarConnection(env) {
  return env.DB.prepare(
    "SELECT * FROM google_calendar_connection WHERE id = 'default'"
  ).first();
}

export async function disconnectGoogleCalendar(env) {
  await env.DB.prepare("DELETE FROM google_calendar_connection WHERE id = 'default'").run();
}
