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

// ---------------------------------------------------------------------
// Branded shell + building blocks -- shared by every email below so a
// palette/logo change happens in one place. Colors and fonts mirror the
// site's own tokens (public/css/styles.css :root) with email-safe font
// fallbacks, since Google Fonts (Playfair Display / Work Sans) aren't
// reliably loaded by mail clients -- Georgia and Helvetica stand in for
// the same serif-display / clean-sans pairing instead.
// ---------------------------------------------------------------------

const COLORS = {
  black: "#14120d",
  ink: "#201c14",
  rust: "#b6862f",
  rustDark: "#8a6624",
  goldLight: "#e0bd6e",
  cream: "#faf6ee",
  cream2: "#f2ead9",
  muted: "#766c5b",
  line: "rgba(20,18,13,0.14)",
};

const FONT_DISPLAY = "Georgia, 'Times New Roman', serif";
const FONT_BODY = "'Helvetica Neue', Helvetica, Arial, sans-serif";

function logoUrl(env) {
  return `${env.SITE_URL}/img/logo.png`;
}

// Wraps a template's body content in the dark-header / cream-body /
// dark-footer shell used across every outgoing email.
function emailShell(env, bodyHtml) {
  return `
  <div style="background:${COLORS.cream2};padding:32px 16px;">
  <div style="max-width:540px;margin:0 auto;font-family:${FONT_BODY};">
    <div style="background:${COLORS.black};padding:26px 24px;text-align:center;border-radius:10px 10px 0 0;">
      <img src="${logoUrl(env)}" alt="${env.BUSINESS_NAME}" style="height:96px;width:96px;display:block;margin:0 auto;">
    </div>
    <div style="background:${COLORS.cream};padding:36px 34px;color:${COLORS.ink};font-size:15px;line-height:1.7;border-left:1px solid ${COLORS.line};border-right:1px solid ${COLORS.line};">
      ${bodyHtml}
    </div>
    <div style="background:${COLORS.black};padding:18px 24px;text-align:center;border-radius:0 0 10px 10px;">
      <div style="color:${COLORS.goldLight};font-family:${FONT_BODY};font-size:11px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;">
        Upscale Gourmet Food Boxes
      </div>
    </div>
  </div>
  </div>`;
}

// Section heading in the site's uppercase display-serif style, with a
// short rust underline for a bit of the gold accenting from the logo.
function emailHeading(text) {
  return `<h2 style="margin:0 0 18px;font-family:${FONT_DISPLAY};font-size:22px;font-weight:700;letter-spacing:0.02em;text-transform:uppercase;color:${COLORS.black};">
    ${text}
    <div style="width:44px;height:2px;background:${COLORS.rust};margin-top:10px;"></div>
  </h2>`;
}

function emailButton(url, label) {
  return `<div style="text-align:center;margin:30px 0 10px;">
    <a href="${url}" style="display:inline-block;background:${COLORS.rust};color:#ffffff;text-decoration:none;font-family:${FONT_BODY};font-weight:700;letter-spacing:0.05em;text-transform:uppercase;font-size:13px;padding:15px 34px;border-radius:4px;">${label}</a>
  </div>`;
}

// One label/value line inside a summaryBox().
function summaryRow(label, value) {
  return `<tr>
    <td style="padding:7px 0;color:${COLORS.muted};font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;white-space:nowrap;vertical-align:top;">${label}</td>
    <td style="padding:7px 0 7px 16px;color:${COLORS.ink};font-size:14px;text-align:right;">${value}</td>
  </tr>`;
}

// A boxed card (cream-2 background, thin rust rule on top) for a set of
// summaryRow()s -- order/booking/contact details, styled like a small
// receipt rather than a bare bullet list.
function summaryBox(rowsHtml) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.cream2};border-top:3px solid ${COLORS.rust};border-radius:6px;padding:18px 20px;margin:20px 0;">
    ${rowsHtml}
  </table>`;
}

function orderItemsHtml(items) {
  if (!items || !items.length) return "";
  const rows = items
    .map(
      (i) =>
        `<tr>
          <td style="padding:6px 0;border-bottom:1px solid ${COLORS.line};font-size:14px;color:${COLORS.ink};">${i.item_name}${i.quantity > 1 ? ` &times;${i.quantity}` : ""}</td>
          <td style="padding:6px 0;border-bottom:1px solid ${COLORS.line};font-size:14px;color:${COLORS.ink};text-align:right;">${i.quoted ? "Custom quote" : money(i.line_total_cents)}</td>
        </tr>`
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;">
    <tr><td colspan="2" style="padding-bottom:6px;color:${COLORS.muted};font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">Order items</td></tr>
    ${rows}
  </table>`;
}

function signatureLine(env) {
  return `<p style="margin:26px 0 0;color:${COLORS.ink};">&mdash; ${env.BUSINESS_NAME}</p>`;
}

// ---- custom-order (booking) emails ----------------------------------------

export function bookingRequestEmailToClient(env, booking) {
  const body = `
    ${emailHeading("New order request")}
    <p style="margin:0 0 6px;"><strong>${booking.name}</strong> requested a boxed meal order for <strong>${booking.event_date}</strong>.</p>
    ${summaryBox(
      [
        summaryRow("Occasion", booking.event_type),
        summaryRow("Boxes", booking.guest_count),
        summaryRow("Location", booking.location || "—"),
        summaryRow("Budget", booking.budget || "—"),
        summaryRow("Email", booking.email),
        summaryRow("Phone", booking.phone || "—"),
        summaryRow("Notes", booking.notes || "—"),
        summaryRow(
          "Order total",
          booking.order_total_cents != null ? `<strong>${money(booking.order_total_cents)}</strong>` : "Needs quote"
        ),
      ].join("")
    )}
    ${orderItemsHtml(booking.order_items)}
    ${emailButton(`${env.SITE_URL}/admin/`, "Review in admin")}
  `;
  return emailShell(env, body);
}

export function bookingReceivedEmailToCustomer(env, booking) {
  const body = `
    ${emailHeading(`Thanks, ${booking.name}!`)}
    <p>We received your order request for <strong>${booking.event_date}</strong> and it's now pending review.</p>
    <p>You'll get a follow-up email as soon as it's approved, along with a secure link to pay your ${
      booking.deposit_percent || 50
    }% deposit and lock in the date.</p>
    ${signatureLine(env)}
  `;
  return emailShell(env, body);
}

// checkoutPageUrl points at OUR OWN /booking/checkout/ page, not a raw
// Stripe URL — the Stripe Checkout Session itself is only created the
// moment the customer clicks "Pay" there, so this link can safely stay
// valid for the full DEPOSIT_LINK_EXPIRY_HOURS window even though a single
// Stripe session can't.
export function bookingApprovedEmailToCustomer(env, booking, checkoutPageUrl) {
  const body = `
    ${emailHeading(`You're approved!`)}
    <p>Hi ${booking.name}, your order request for <strong>${booking.event_date}</strong> has been approved.</p>
    ${summaryBox(
      [
        summaryRow("Order total", money(booking.order_total_cents)),
        summaryRow(
          `Deposit (${booking.deposit_percent || 50}%)`,
          `<strong>${money(booking.deposit_amount_cents)}</strong>`
        ),
      ].join("")
    )}
    <p>To hold your date, please pay your deposit using the secure link below:</p>
    ${emailButton(checkoutPageUrl, "Pay deposit")}
    <p style="color:${COLORS.muted};font-size:13px;text-align:center;">This link is valid for ${env.DEPOSIT_LINK_EXPIRY_HOURS || 72} hours. If it expires, just reply to this email and we'll send a new one.</p>
    ${signatureLine(env)}
  `;
  return emailShell(env, body);
}

export function bookingRejectedEmailToCustomer(env, booking) {
  const body = `
    ${emailHeading("Update on your request")}
    <p>Hi ${booking.name}, unfortunately we're not able to accommodate your request for <strong>${booking.event_date}</strong>.</p>
    <p>Please reach out or submit a new request with alternate dates — we'd love to find a fit.</p>
    ${signatureLine(env)}
  `;
  return emailShell(env, body);
}

export function depositConfirmedEmail(env, booking) {
  const body = `
    ${emailHeading("You're booked!")}
    <p>Hi ${booking.name}, your ${money(booking.deposit_amount_cents)} deposit is confirmed and <strong>${booking.event_date}</strong> is locked in.</p>
    <p>We'll be in touch about final details closer to the delivery date.</p>
    ${signatureLine(env)}
  `;
  return emailShell(env, body);
}

export function contactMessageEmailToClient(env, msg) {
  const body = `
    ${emailHeading("New contact form message")}
    ${summaryBox(
      [
        summaryRow("Name", msg.name),
        summaryRow("Email", msg.email),
        summaryRow("Phone", msg.phone || "—"),
        summaryRow("Boxes", msg.guest_count || "—"),
        summaryRow("Date", msg.event_date || "—"),
        summaryRow("Location", msg.location || "—"),
        summaryRow("Budget", msg.budget || "—"),
      ].join("")
    )}
    <p style="white-space:pre-wrap;">${(msg.message || "").replace(/\n/g, "<br>")}</p>
  `;
  return emailShell(env, body);
}

// ---- lunch-sale emails ------------------------------------------------

export function lunchSaleOrderReceivedEmailToClient(env, order, event) {
  const body = `
    ${emailHeading("New paid lunch order")}
    ${summaryBox(
      [
        summaryRow("Customer", `${order.name}${order.phone ? ` &middot; ${order.phone}` : ""}`),
        summaryRow("Email", order.email),
        summaryRow("Event", event.title),
        summaryRow("Quantity", order.quantity),
        summaryRow("Drop-off", order.dropoff_choice),
        summaryRow("Total", `<strong>${money(order.total_cents)}</strong>`),
      ].join("")
    )}
    ${emailButton(`${env.SITE_URL}/admin/`, "View in admin")}
  `;
  return emailShell(env, body);
}

export function lunchSaleOrderConfirmedEmail(env, order, event) {
  const body = `
    ${emailHeading("You're all set!")}
    <p>Hi ${order.name}, your payment of <strong>${money(order.total_cents)}</strong> for ${order.quantity} lunch(es) — <strong>${event.title}</strong> — is confirmed.</p>
    ${summaryBox([summaryRow("Drop-off", order.dropoff_choice)].join(""))}
    <p>${event.menu_description}</p>
    ${signatureLine(env)}
  `;
  return emailShell(env, body);
}

// checkoutPageUrl points at OUR OWN /lunch-sale/checkout/ page, not a raw
// Stripe URL — same pattern as bookingApprovedEmailToCustomer, so the
// PaymentIntent backing it is only created the moment the customer opens
// the page (see handleLunchSaleOrderPaymentIntent in index.js).
export function lunchSalePaymentLinkEmail(env, order, event, checkoutPageUrl) {
  const body = `
    ${emailHeading("Finish your order")}
    <p>Hi ${order.name}, here's your payment link for ${order.quantity} lunch(es) — <strong>${event.title}</strong>.</p>
    ${summaryBox(
      [
        summaryRow("Drop-off", order.dropoff_choice),
        summaryRow("Total", `<strong>${money(order.total_cents)}</strong>`),
      ].join("")
    )}
    ${emailButton(checkoutPageUrl, "Pay now")}
    <p style="color:${COLORS.muted};font-size:13px;text-align:center;">Orders for this sale close ${new Date(event.order_cutoff_at).toLocaleString()}.</p>
    ${signatureLine(env)}
  `;
  return emailShell(env, body);
}

export function lunchSaleSignupConfirmedEmail(env) {
  const body = `
    ${emailHeading("You're on the list!")}
    <p>We'll email you the moment the next lunch sale opens.</p>
    ${signatureLine(env)}
  `;
  return emailShell(env, body);
}

// Sent by the admin (manual trigger) to everyone on the notify list when a
// new lunch sale goes live.
export function lunchSaleNowLiveEmail(env, event) {
  const body = `
    ${emailHeading(`${event.title} is open!`)}
    <p>${event.menu_description}</p>
    ${summaryBox(
      [
        summaryRow("Price", money(event.price_cents)),
        summaryRow("Orders close", new Date(event.order_cutoff_at).toLocaleString()),
      ].join("")
    )}
    ${emailButton(`${env.SITE_URL}/lunch-sale/`, "Order now")}
    ${signatureLine(env)}
  `;
  return emailShell(env, body);
}

// ---- internal (admin) notices ------------------------------------------
// Short one-line heads-up emails to CLIENT_NOTIFY_EMAIL, wrapped in the
// same shell as everything else for consistency even though they're
// internal-only. Previously these were built as raw <p> strings directly
// in index.js; moved here so every outgoing email goes through one place.

export function depositPaidAdminNotice(env, confirmed) {
  const body = `
    ${emailHeading("Deposit paid")}
    <p>${confirmed.name} paid their deposit for <strong>${confirmed.event_date}</strong>. Booking confirmed.</p>
  `;
  return emailShell(env, body);
}

export function lunchOrderPaidAdminNotice(env, paidOrder, event) {
  const body = `
    ${emailHeading("Lunch order paid")}
    ${summaryBox(
      [
        summaryRow("Customer", paidOrder.name),
        summaryRow("Event", event.title),
        summaryRow("Quantity", `${paidOrder.quantity} &times; ${event.title}`),
        summaryRow("Total", `<strong>${money(paidOrder.total_cents)}</strong>`),
        summaryRow("Drop-off", paidOrder.dropoff_choice),
      ].join("")
    )}
  `;
  return emailShell(env, body);
}
