// Minimal Resend (https://resend.com) client using fetch — no SDK dependency.
// Free tier is plenty for a boxed-meal catering business's order/contact volume.
// Set RESEND_API_KEY via: wrangler secret put RESEND_API_KEY

export async function sendEmail(env, { to, subject, html, replyTo }) {
  if (!env.RESEND_API_KEY) {
    console.warn(
      "[email] RESEND_API_KEY not set — skipping send. Would have sent:",
      { to, subject }
    );
    return { skipped: true };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${env.BUSINESS_NAME} <${env.FROM_EMAIL}>`,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("[email] Resend error", res.status, text);
    throw new Error(`Email send failed (${res.status})`);
  }
  return res.json();
}

function money(cents) {
  return `$${((cents || 0) / 100).toFixed(2)}`;
}

function orderItemsHtml(items) {
  if (!items || !items.length) return "";
  const rows = items
    .map(
      (i) =>
        `<li>${i.item_name}${i.quantity > 1 ? ` x${i.quantity}` : ""} — ${
          i.quoted ? "custom quote" : money(i.line_total_cents)
        }</li>`
    )
    .join("");
  return `<ul>${rows}</ul>`;
}

// ---- custom-order (booking) emails ----------------------------------------

export function bookingRequestEmailToClient(env, booking) {
  return `
    <h2>New order request — ${env.BUSINESS_NAME}</h2>
    <p><strong>${booking.name}</strong> requested a boxed meal order for <strong>${booking.event_date}</strong>.</p>
    <ul>
      <li>Occasion: ${booking.event_type}</li>
      <li>Boxes: ${booking.guest_count}</li>
      <li>Location: ${booking.location || "—"}</li>
      <li>Budget: ${booking.budget || "—"}</li>
      <li>Email: ${booking.email}</li>
      <li>Phone: ${booking.phone || "—"}</li>
      <li>Notes: ${booking.notes || "—"}</li>
      <li>Order total: ${booking.order_total_cents != null ? money(booking.order_total_cents) : "needs quote"}</li>
    </ul>
    ${orderItemsHtml(booking.order_items)}
    <p>Approve or decline this request from the admin page: ${env.SITE_URL}/admin/</p>
  `;
}

export function bookingReceivedEmailToCustomer(env, booking) {
  return `
    <h2>Thanks, ${booking.name}!</h2>
    <p>We received your order request for <strong>${booking.event_date}</strong> and it's now pending review.</p>
    <p>You'll get a follow-up email as soon as it's approved, along with a secure link to pay your ${
      booking.deposit_percent || 50
    }% deposit and lock in the date.</p>
    <p>— ${env.BUSINESS_NAME}</p>
  `;
}

// checkoutPageUrl points at OUR OWN /booking/checkout/ page, not a raw
// Stripe URL — the Stripe Checkout Session itself is only created the
// moment the customer clicks "Pay" there, so this link can safely stay
// valid for the full DEPOSIT_LINK_EXPIRY_HOURS window even though a single
// Stripe session can't.
export function bookingApprovedEmailToCustomer(env, booking, checkoutPageUrl) {
  return `
    <h2>You're approved for ${booking.event_date}!</h2>
    <p>Hi ${booking.name}, your order request has been approved. To hold your date, please pay your
    ${money(booking.deposit_amount_cents)} deposit (${booking.deposit_percent || 50}% of your ${money(
      booking.order_total_cents
    )} order) using the secure link below:</p>
    <p><a href="${checkoutPageUrl}" style="display:inline-block;padding:12px 20px;background:#C08830;color:#fff;text-decoration:none;border-radius:4px;">Pay deposit</a></p>
    <p>This link is valid for ${env.DEPOSIT_LINK_EXPIRY_HOURS || 72} hours. If it expires, just reply to this email and we'll send a new one.</p>
    <p>— ${env.BUSINESS_NAME}</p>
  `;
}

export function bookingRejectedEmailToCustomer(env, booking) {
  return `
    <h2>Update on your request for ${booking.event_date}</h2>
    <p>Hi ${booking.name}, unfortunately we're not able to accommodate this date/order. Please reach out or submit a new request with alternate dates.</p>
    <p>— ${env.BUSINESS_NAME}</p>
  `;
}

export function depositConfirmedEmail(env, booking) {
  return `
    <h2>Deposit received — ${booking.event_date} is booked!</h2>
    <p>Hi ${booking.name}, your ${money(booking.deposit_amount_cents)} deposit is confirmed and your date is locked in.</p>
    <p>We'll be in touch about final details closer to the delivery date.</p>
    <p>— ${env.BUSINESS_NAME}</p>
  `;
}

export function contactMessageEmailToClient(env, msg) {
  return `
    <h2>New contact form message — ${env.BUSINESS_NAME}</h2>
    <ul>
      <li>Name: ${msg.name}</li>
      <li>Email: ${msg.email}</li>
      <li>Phone: ${msg.phone || "—"}</li>
      <li>Boxes: ${msg.guest_count || "—"}</li>
      <li>Date: ${msg.event_date || "—"}</li>
      <li>Location: ${msg.location || "—"}</li>
      <li>Budget: ${msg.budget || "—"}</li>
    </ul>
    <p>${(msg.message || "").replace(/\n/g, "<br>")}</p>
  `;
}

// ---- lunch-sale emails ------------------------------------------------

export function lunchSaleOrderReceivedEmailToClient(env, order, event) {
  return `
    <h2>New paid lunch order — ${event.title}</h2>
    <ul>
      <li>${order.name} (${order.email}${order.phone ? `, ${order.phone}` : ""})</li>
      <li>Quantity: ${order.quantity}</li>
      <li>Drop-off: ${order.dropoff_choice}</li>
      <li>Total: ${money(order.total_cents)}</li>
    </ul>
    <p>View all lunch-sale orders from the admin page: ${env.SITE_URL}/admin/</p>
  `;
}

export function lunchSaleOrderConfirmedEmail(env, order, event) {
  return `
    <h2>You're all set — ${event.title}!</h2>
    <p>Hi ${order.name}, your payment of ${money(order.total_cents)} for ${order.quantity} lunch(es) is confirmed.</p>
    <p><strong>Drop-off:</strong> ${order.dropoff_choice}</p>
    <p>${event.menu_description}</p>
    <p>— ${env.BUSINESS_NAME}</p>
  `;
}

export function lunchSaleSignupConfirmedEmail(env) {
  return `
    <h2>You're on the list!</h2>
    <p>We'll email you the moment the next lunch sale opens.</p>
    <p>— ${env.BUSINESS_NAME}</p>
  `;
}

// Sent by the admin (manual trigger) to everyone on the notify list when a
// new lunch sale goes live.
export function lunchSaleNowLiveEmail(env, event) {
  return `
    <h2>${event.title} is open for orders!</h2>
    <p>${event.menu_description}</p>
    <p>${money(event.price_cents)} per lunch. Orders close ${new Date(
      event.order_cutoff_at
    ).toLocaleString()}.</p>
    <p><a href="${env.SITE_URL}/lunch-sale/" style="display:inline-block;padding:12px 20px;background:#C08830;color:#fff;text-decoration:none;border-radius:4px;">Order now</a></p>
    <p>— ${env.BUSINESS_NAME}</p>
  `;
}
