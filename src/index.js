import {
  json,
  badRequest,
  newId,
  nowIso,
  isValidDateString,
  isFutureDate,
  isValidEmail,
} from "./lib/util.js";
import {
  insertBooking,
  getBooking,
  updateBookingStatus,
  listPendingBookings,
  listBookedDatesInRange,
  listBlockedDatesInRange,
  insertContactMessage,
  findBookingByStripeSession,
} from "./lib/db.js";
import {
  sendEmail,
  bookingRequestEmailToClient,
  bookingReceivedEmailToCustomer,
  bookingApprovedEmailToCustomer,
  bookingRejectedEmailToCustomer,
  depositConfirmedEmail,
  contactMessageEmailToClient,
} from "./lib/email.js";
import { createDepositCheckoutSession, verifyStripeWebhook } from "./lib/stripe.js";

const EVENT_TYPES = new Set(["corporate", "wedding", "private"]);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === "OPTIONS" && pathname.startsWith("/api/")) {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type,X-Admin-Key",
        },
      });
    }

    try {
      if (pathname === "/api/availability" && request.method === "GET") {
        return handleAvailability(url, env);
      }
      if (pathname === "/api/booking" && request.method === "POST") {
        return handleCreateBooking(request, env);
      }
      if (pathname === "/api/contact" && request.method === "POST") {
        return handleContact(request, env);
      }
      if (pathname === "/api/stripe/webhook" && request.method === "POST") {
        return handleStripeWebhook(request, env);
      }
      if (pathname === "/api/admin/bookings" && request.method === "GET") {
        return handleAdminList(request, env);
      }
      if (
        pathname.match(/^\/api\/admin\/bookings\/[^/]+\/approve$/) &&
        request.method === "POST"
      ) {
        return handleAdminApprove(request, env, pathname);
      }
      if (
        pathname.match(/^\/api\/admin\/bookings\/[^/]+\/reject$/) &&
        request.method === "POST"
      ) {
        return handleAdminReject(request, env, pathname);
      }

      if (pathname.startsWith("/api/")) {
        return json({ error: "Not found" }, 404);
      }

      // Everything else is a static asset from /public.
      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error("[worker] unhandled error", err);
      return json({ error: "Internal error" }, 500);
    }
  },
};

// ---- availability ----------------------------------------------------

async function handleAvailability(url, env) {
  const month = url.searchParams.get("month"); // YYYY-MM
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return badRequest("Provide ?month=YYYY-MM");
  }
  const start = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = `${month}-${String(lastDay).padStart(2, "0")}`;

  const [booked, blocked] = await Promise.all([
    listBookedDatesInRange(env, start, end),
    listBlockedDatesInRange(env, start, end),
  ]);

  const unavailable = new Set([...booked, ...blocked.map((b) => b.date)]);
  return json({ month, unavailable: [...unavailable].sort() });
}

// ---- booking request ----------------------------------------------------

async function handleCreateBooking(request, env) {
  const body = await request.json().catch(() => null);
  if (!body) return badRequest("Invalid JSON body");

  const { name, email, phone, event_type, event_date, guest_count, location, budget, notes } =
    body;

  if (!name || !email || !event_type || !event_date || !guest_count) {
    return badRequest("Missing required fields");
  }
  if (!isValidEmail(email)) return badRequest("Invalid email");
  if (!EVENT_TYPES.has(event_type)) return badRequest("Invalid event_type");
  if (!isValidDateString(event_date)) return badRequest("Invalid event_date");
  if (!isFutureDate(event_date)) return badRequest("event_date must be in the future");
  const guests = Number(guest_count);
  if (!Number.isFinite(guests) || guests < 1) return badRequest("Invalid guest_count");

  // Reject if already booked/blocked that day.
  const [booked, blocked] = await Promise.all([
    listBookedDatesInRange(env, event_date, event_date),
    listBlockedDatesInRange(env, event_date, event_date),
  ]);
  if (booked.length || blocked.length) {
    return json({ error: "That date is no longer available" }, 409);
  }

  const booking = {
    id: newId(),
    name,
    email,
    phone: phone || null,
    event_type,
    event_date,
    guest_count: guests,
    location: location || null,
    budget: budget || null,
    notes: notes || null,
    status: "pending_approval",
    deposit_amount_cents: Number(env.DEPOSIT_AMOUNT_CENTS || 15000),
    created_at: nowIso(),
    updated_at: nowIso(),
  };

  await insertBooking(env, booking);

  await Promise.allSettled([
    sendEmail(env, {
      to: env.CLIENT_NOTIFY_EMAIL,
      subject: `New booking request — ${event_date}`,
      html: bookingRequestEmailToClient(env, booking),
      replyTo: email,
    }),
    sendEmail(env, {
      to: email,
      subject: `We received your request — ${env.BUSINESS_NAME}`,
      html: bookingReceivedEmailToCustomer(env, booking),
    }),
  ]);

  return json({ ok: true, booking_id: booking.id, status: booking.status });
}

// ---- contact form ----------------------------------------------------

async function handleContact(request, env) {
  const body = await request.json().catch(() => null);
  if (!body) return badRequest("Invalid JSON body");

  const { name, email, phone, guest_count, event_date, location, budget, message } = body;
  if (!name || !email) return badRequest("Missing required fields");
  if (!isValidEmail(email)) return badRequest("Invalid email");
  if (event_date && !isValidDateString(event_date)) return badRequest("Invalid event_date");

  const msg = {
    id: newId(),
    name,
    email,
    phone: phone || null,
    guest_count: guest_count ? Number(guest_count) : null,
    event_date: event_date || null,
    location: location || null,
    budget: budget || null,
    message: message || null,
    created_at: nowIso(),
  };

  await insertContactMessage(env, msg);

  await sendEmail(env, {
    to: env.CLIENT_NOTIFY_EMAIL,
    subject: `New contact form message from ${name}`,
    html: contactMessageEmailToClient(env, msg),
    replyTo: email,
  });

  return json({ ok: true });
}

// ---- admin ----------------------------------------------------

function requireAdmin(request, env) {
  const key = request.headers.get("X-Admin-Key");
  return env.ADMIN_KEY && key === env.ADMIN_KEY;
}

async function handleAdminList(request, env) {
  if (!requireAdmin(request, env)) return json({ error: "Unauthorized" }, 401);
  const bookings = await listPendingBookings(env);
  return json({ bookings });
}

async function handleAdminApprove(request, env, pathname) {
  if (!requireAdmin(request, env)) return json({ error: "Unauthorized" }, 401);
  const id = pathname.split("/")[4];
  const booking = await getBooking(env, id);
  if (!booking) return json({ error: "Not found" }, 404);

  const session = await createDepositCheckoutSession(env, booking);

  await updateBookingStatus(env, id, "approved", {
    stripe_checkout_session_id: session.id,
  });

  await sendEmail(env, {
    to: booking.email,
    subject: `You're approved for ${booking.event_date}! Next step: deposit`,
    html: bookingApprovedEmailToCustomer(env, booking, session.url),
  });

  return json({ ok: true, checkout_url: session.url });
}

async function handleAdminReject(request, env, pathname) {
  if (!requireAdmin(request, env)) return json({ error: "Unauthorized" }, 401);
  const id = pathname.split("/")[4];
  const booking = await getBooking(env, id);
  if (!booking) return json({ error: "Not found" }, 404);

  await updateBookingStatus(env, id, "rejected");

  await sendEmail(env, {
    to: booking.email,
    subject: `Update on your request for ${booking.event_date}`,
    html: bookingRejectedEmailToCustomer(env, booking),
  });

  return json({ ok: true });
}

// ---- stripe webhook ----------------------------------------------------

async function handleStripeWebhook(request, env) {
  const payloadText = await request.text();
  const signature = request.headers.get("Stripe-Signature");

  const valid = await verifyStripeWebhook(
    payloadText,
    signature,
    env.STRIPE_WEBHOOK_SECRET
  );
  if (!valid) return json({ error: "Invalid signature" }, 400);

  const event = JSON.parse(payloadText);

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const bookingId = session.client_reference_id;
    const booking = bookingId
      ? await getBooking(env, bookingId)
      : await findBookingByStripeSession(env, session.id);

    if (booking) {
      await updateBookingStatus(env, booking.id, "confirmed", {
        stripe_payment_status: "paid",
      });

      // TODO(Google Calendar): once wired up, create a calendar event here
      // for booking.event_date using the client's connected Google account.

      await sendEmail(env, {
        to: booking.email,
        subject: `Deposit received — ${booking.event_date} is booked!`,
        html: depositConfirmedEmail(env, booking),
      });
      await sendEmail(env, {
        to: env.CLIENT_NOTIFY_EMAIL,
        subject: `Deposit paid — ${booking.event_date} (${booking.name})`,
        html: `<p>${booking.name} paid their deposit for ${booking.event_date}. Booking confirmed.</p>`,
      });
    }
  }

  return json({ received: true });
}
