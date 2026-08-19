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
    </ul>
    <p>Approve or decline this request from the admin page: ${env.SITE_URL}/admin/</p>
  `;
}

export function bookingReceivedEmailToCustomer(env, booking) {
  return `
    <h2>Thanks, ${booking.name}!</h2>
    <p>We received your order request for <strong>${booking.event_date}</strong> and it's now pending review.</p>
    <p>You'll get a follow-up email as soon as it's approved, along with a secure link to pay your ${(
      (booking.deposit_amount_cents || 0) / 100
    ).toFixed(2)} USD deposit and lock in the date.</p>
    <p>— ${env.BUSINESS_NAME}</p>
  `;
}

export function bookingApprovedEmailToCustomer(env, booking, checkoutUrl) {
  return `
    <h2>You're approved for ${booking.event_date}!</h2>
    <p>Hi ${booking.name}, your order request has been approved. To hold your date, please pay your
    $${((booking.deposit_amount_cents || 0) / 100).toFixed(2)} deposit using the secure link below:</p>
    <p><a href="${checkoutUrl}" style="display:inline-block;padding:12px 20px;background:#C08830;color:#fff;text-decoration:none;border-radius:4px;">Pay deposit</a></p>
    <p>This is a Stripe <strong>test-mode</strong> payment link for the mockup — no real charge will occur.</p>
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
    <p>Hi ${booking.name}, your $${((booking.deposit_amount_cents || 0) / 100).toFixed(
      2
    )} deposit is confirmed and your date is locked in.</p>
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
