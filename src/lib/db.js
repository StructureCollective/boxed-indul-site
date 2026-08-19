export async function getBooking(env, id) {
  return env.DB.prepare("SELECT * FROM bookings WHERE id = ?").bind(id).first();
}

export async function insertBooking(env, booking) {
  await env.DB.prepare(
    `INSERT INTO bookings
      (id, name, email, phone, event_type, event_date, guest_count, location, budget, notes,
       status, deposit_amount_cents, stripe_payment_status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
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
      booking.status,
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
    "SELECT date, reason FROM blocked_dates WHERE date BETWEEN ? AND ?"
  )
    .bind(startDate, endDate)
    .all();
  return results;
}

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

export async function findBookingByStripeSession(env, sessionId) {
  return env.DB.prepare(
    "SELECT * FROM bookings WHERE stripe_checkout_session_id = ?"
  )
    .bind(sessionId)
    .first();
}
