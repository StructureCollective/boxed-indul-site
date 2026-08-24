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
  listAllBookings,
  listBookedDatesInRange,
  listBlockedDatesInRange,
  insertContactMessage,
  listAllContactMessages,
  findBookingByStripeSession,
  insertLunchSaleEvent,
  updateLunchSaleEvent,
  getLunchSaleEvent,
  getCurrentLiveLunchSaleEvent,
  listAllLunchSaleEvents,
  insertLunchSaleOrder,
  updateLunchSaleOrderStatus,
  getLunchSaleOrder,
  findLunchSaleOrderByStripeSession,
  countActiveLunchSaleOrders,
  listAllLunchSaleOrders,
  insertLunchSaleSignup,
  listLunchSaleSignups,
  saveGoogleCalendarConnection,
  getGoogleCalendarConnection,
  disconnectGoogleCalendar,
} from "./lib/db.js";
import {
  sendEmail,
  bookingRequestEmailToClient,
  bookingReceivedEmailToCustomer,
  bookingApprovedEmailToCustomer,
  bookingRejectedEmailToCustomer,
  depositConfirmedEmail,
  contactMessageEmailToClient,
  lunchSaleOrderReceivedEmailToClient,
  lunchSaleOrderConfirmedEmail,
  lunchSaleSignupConfirmedEmail,
  lunchSaleNowLiveEmail,
} from "./lib/email.js";
import {
  createDepositCheckoutSession,
  createLunchSaleCheckoutSession,
  verifyStripeWebhook,
} from "./lib/stripe.js";
import { priceOrder } from "./lib/menu-data.js";
import { verifyAccessJwt } from "./lib/access.js";
import {
  buildGoogleAuthUrl,
  exchangeCodeForTokens,
  getConnectedEmail,
  pushBookingToCalendar,
  syncBusyDatesFromCalendar,
} from "./lib/calendar.js";

const EVENT_TYPES = new Set(["corporate", "wedding", "private"]);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === "OPTIONS" && pathname.startsWith("/api/")) {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    try {
      // ---- public ----
      if (pathname === "/api/availability" && request.method === "GET") {
        return handleAvailability(url, env);
      }
      if (pathname === "/api/booking" && request.method === "POST") {
        return handleCreateBooking(request, env);
      }
      if (pathname.match(/^\/api\/booking\/[^/]+\/checkout-info$/) && request.method === "GET") {
        return handleBookingCheckoutInfo(env, pathname);
      }
      if (
        pathname.match(/^\/api\/booking\/[^/]+\/checkout-session$/) &&
        request.method === "POST"
      ) {
        return handleCreateDepositCheckoutSession(env, pathname);
      }
      if (pathname === "/api/contact" && request.method === "POST") {
        return handleContact(request, env);
      }
      if (pathname === "/api/lunch-sale/current" && request.method === "GET") {
        return handleLunchSaleCurrent(env);
      }
      if (
        pathname.match(/^\/api\/lunch-sale\/[^/]+\/order$/) &&
        request.method === "POST"
      ) {
        return handleCreateLunchSaleOrder(request, env, pathname);
      }
      if (pathname === "/api/lunch-sale/signup" && request.method === "POST") {
        return handleLunchSaleSignup(request, env);
      }
      if (pathname === "/api/stripe/webhook" && request.method === "POST") {
        return handleStripeWebhook(request, env);
      }

      // ---- admin (Cloudflare Access protects /admin/* at the edge; we
      // still verify the Access JWT here so /api/admin/* can't be hit
      // directly without a valid session) ----
      if (pathname.startsWith("/api/admin/")) {
        const identity = await verifyAccessJwt(request, env);
        if (!identity) return json({ error: "Unauthorized" }, 401);
        return routeAdmin(request, env, pathname, identity);
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

  // Daily cron (see wrangler.jsonc triggers.crons) — pulls busy dates from
  // the connected Google Calendar so personal events block new requests
  // even if nobody opens the admin page that day.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      syncBusyDatesFromCalendar(env).catch((err) =>
        console.error("[cron] calendar sync failed", err)
      )
    );
  },
};

async function routeAdmin(request, env, pathname, identity) {
  if (pathname === "/api/admin/bookings" && request.method === "GET") {
    return json({ bookings: await listAllBookings(env) });
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
    return handleAdminReject(env, pathname);
  }
  if (
    pathname.match(/^\/api\/admin\/bookings\/[^/]+\/resend-deposit-link$/) &&
    request.method === "POST"
  ) {
    return handleAdminResendDepositLink(env, pathname);
  }
  if (pathname === "/api/admin/contacts" && request.method === "GET") {
    return json({ contacts: await listAllContactMessages(env) });
  }
  if (pathname === "/api/admin/blocked-dates" && request.method === "GET") {
    const url = new URL(request.url);
    const start = url.searchParams.get("start") || "0000-01-01";
    const end = url.searchParams.get("end") || "9999-12-31";
    return json({ blocked: await listBlockedDatesInRange(env, start, end) });
  }
  if (pathname === "/api/admin/blocked-dates" && request.method === "POST") {
    return handleAdminAddBlockedDate(request, env);
  }
  if (
    pathname.match(/^\/api\/admin\/blocked-dates\/[^/]+$/) &&
    request.method === "DELETE"
  ) {
    const date = decodeURIComponent(pathname.split("/")[4]);
    await env.DB.prepare("DELETE FROM blocked_dates WHERE date = ?").bind(date).run();
    return json({ ok: true });
  }

  // ---- lunch-sale admin ----
  if (pathname === "/api/admin/lunch-sale/events" && request.method === "GET") {
    return json({ events: await listAllLunchSaleEvents(env) });
  }
  if (pathname === "/api/admin/lunch-sale/events" && request.method === "POST") {
    return handleAdminCreateLunchSaleEvent(request, env);
  }
  if (
    pathname.match(/^\/api\/admin\/lunch-sale\/events\/[^/]+$/) &&
    request.method === "PATCH"
  ) {
    return handleAdminUpdateLunchSaleEvent(request, env, pathname);
  }
  if (
    pathname.match(/^\/api\/admin\/lunch-sale\/events\/[^/]+\/notify-signups$/) &&
    request.method === "POST"
  ) {
    return handleAdminNotifySignups(env, pathname);
  }
  if (pathname === "/api/admin/lunch-sale/orders" && request.method === "GET") {
    return json({ orders: await listAllLunchSaleOrders(env) });
  }
  if (pathname === "/api/admin/lunch-sale/signups" && request.method === "GET") {
    return json({ signups: await listLunchSaleSignups(env) });
  }

  // ---- Google Calendar admin ----
  if (pathname === "/api/admin/google/status" && request.method === "GET") {
    const conn = await getGoogleCalendarConnection(env);
    return json({
      connected: !!conn,
      connected_email: conn?.connected_email || null,
      last_synced_at: conn?.last_synced_at || null,
    });
  }
  if (pathname === "/api/admin/google/connect" && request.method === "GET") {
    const state = crypto.randomUUID();
    return Response.redirect(buildGoogleAuthUrl(env, state), 302);
  }
  if (pathname === "/api/admin/google/callback" && request.method === "GET") {
    return handleGoogleCallback(request, env);
  }
  if (pathname === "/api/admin/google/disconnect" && request.method === "POST") {
    await disconnectGoogleCalendar(env);
    return json({ ok: true });
  }
  if (pathname === "/api/admin/google/sync-now" && request.method === "POST") {
    const result = await syncBusyDatesFromCalendar(env);
    return json(result);
  }

  return json({ error: "Not found" }, 404);
}

// ---- Google Calendar OAuth callback. Google redirects the browser here as
// a full page navigation (not a fetch/XHR call), so there's no
// Cf-Access-Jwt-Assertion header — but the routeAdmin() caller already
// verified the Access session via the CF_Authorization cookie, which
// persists across the round trip to Google and back since it's a cookie on
// our own domain. ----
async function handleGoogleCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) return badRequest("Missing code");

  const tokens = await exchangeCodeForTokens(env, code);
  if (!tokens.refresh_token) {
    return json(
      {
        error:
          "Google didn't return a refresh token. Disconnect any prior authorization for this app at https://myaccount.google.com/permissions and try again.",
      },
      400
    );
  }
  const connectedEmail = await getConnectedEmail(tokens.access_token);
  await saveGoogleCalendarConnection(env, {
    refreshToken: tokens.refresh_token,
    connectedEmail,
  });

  return Response.redirect(`${env.SITE_URL}/admin/#calendar-connected`, 302);
}

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

// ---- custom-order booking request -----------------------------------------

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

  let priced;
  try {
    priced = await priceOrder(env, { ...body, guest_count: guests });
  } catch (err) {
    return badRequest(err.message);
  }

  // Reject if already booked/blocked that day.
  const [booked, blocked] = await Promise.all([
    listBookedDatesInRange(env, event_date, event_date),
    listBlockedDatesInRange(env, event_date, event_date),
  ]);
  if (booked.length || blocked.length) {
    return json({ error: "That date is no longer available" }, 409);
  }

  const depositPercent = Number(env.DEPOSIT_PERCENT || 50);
  const depositAmount = priced.order_total_cents
    ? Math.round((priced.order_total_cents * depositPercent) / 100)
    : Number(env.DEPOSIT_MIN_CENTS || 5000);

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
    menu_type: body.menu_type || null,
    order_items: priced.order_items,
    order_total_cents: priced.order_total_cents,
    status: "pending_approval",
    deposit_percent: depositPercent,
    deposit_amount_cents: depositAmount,
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

  return json({
    ok: true,
    booking_id: booking.id,
    status: booking.status,
    order_total_cents: booking.order_total_cents,
    has_quoted_items: priced.has_quoted_items,
  });
}

// Public info for the /booking/checkout/ page — deliberately minimal.
async function handleBookingCheckoutInfo(env, pathname) {
  const id = pathname.split("/")[3];
  const booking = await getBooking(env, id);
  if (!booking) return json({ error: "Not found" }, 404);

  const expired =
    booking.deposit_link_expires_at &&
    new Date(booking.deposit_link_expires_at).getTime() < Date.now();

  return json({
    id: booking.id,
    name: booking.name,
    event_date: booking.event_date,
    guest_count: booking.guest_count,
    order_total_cents: booking.order_total_cents,
    deposit_amount_cents: booking.deposit_amount_cents,
    deposit_percent: booking.deposit_percent,
    status: booking.status,
    expired: !!expired,
  });
}

async function handleCreateDepositCheckoutSession(env, pathname) {
  const id = pathname.split("/")[3];
  const booking = await getBooking(env, id);
  if (!booking) return json({ error: "Not found" }, 404);
  if (booking.status !== "approved") {
    return json({ error: "This order isn't ready for payment yet." }, 409);
  }
  if (
    booking.deposit_link_expires_at &&
    new Date(booking.deposit_link_expires_at).getTime() < Date.now()
  ) {
    return json(
      { error: "This deposit link has expired. Please contact us for a new one." },
      410
    );
  }

  const session = await createDepositCheckoutSession(env, booking);
  await updateBookingStatus(env, id, "approved", {
    stripe_checkout_session_id: session.id,
  });
  return json({ checkout_url: session.url });
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

// ---- lunch-sale (public) ------------------------------------------------

async function handleLunchSaleCurrent(env) {
  const event = await getCurrentLiveLunchSaleEvent(env);
  return json({ event });
}

async function handleCreateLunchSaleOrder(request, env, pathname) {
  const eventId = pathname.split("/")[3];
  const body = await request.json().catch(() => null);
  if (!body) return badRequest("Invalid JSON body");

  const { name, email, phone, quantity, dropoff_choice } = body;
  if (!name || !email || !quantity || !dropoff_choice) {
    return badRequest("Missing required fields");
  }
  if (!isValidEmail(email)) return badRequest("Invalid email");
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty < 1) return badRequest("Invalid quantity");

  const event = await getLunchSaleEvent(env, eventId);
  if (!event || event.status !== "live") {
    return json({ error: "This lunch sale isn't open right now." }, 409);
  }
  if (new Date(event.order_cutoff_at).getTime() < Date.now()) {
    return json({ error: "Ordering has closed for this lunch sale." }, 409);
  }
  if (qty > (event.max_qty_per_order || 10)) {
    return badRequest(`Max ${event.max_qty_per_order || 10} lunches per order.`);
  }

  // D1 doesn't give us row-level locking, so we recheck the count right
  // before inserting to keep the race window as small as practical. A
  // determined double-click could still slip one order past the cap in a
  // rare race; the admin table makes any overage easy to spot and refund.
  const activeCount = await countActiveLunchSaleOrders(env, eventId);
  if (activeCount >= event.slot_cap) {
    return json({ error: "Sorry, this lunch sale is sold out." }, 409);
  }

  const order = {
    id: newId(),
    event_id: eventId,
    name,
    email,
    phone: phone || null,
    quantity: qty,
    dropoff_choice,
    total_cents: qty * event.price_cents,
    status: "pending_payment",
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  await insertLunchSaleOrder(env, order);

  const session = await createLunchSaleCheckoutSession(env, order, event);
  await updateLunchSaleOrderStatus(env, order.id, "pending_payment", {
    stripe_checkout_session_id: session.id,
  });

  await sendEmail(env, {
    to: env.CLIENT_NOTIFY_EMAIL,
    subject: `New lunch-sale order — ${event.title}`,
    html: lunchSaleOrderReceivedEmailToClient(env, order, event),
    replyTo: email,
  });

  return json({ ok: true, checkout_url: session.url });
}

async function handleLunchSaleSignup(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || !body.email || !isValidEmail(body.email)) {
    return badRequest("Valid email required");
  }
  await insertLunchSaleSignup(env, {
    id: newId(),
    email: body.email,
    created_at: nowIso(),
  });
  await sendEmail(env, {
    to: body.email,
    subject: `You're on the list — ${env.BUSINESS_NAME}`,
    html: lunchSaleSignupConfirmedEmail(env),
  }).catch(() => {});
  return json({ ok: true });
}

// ---- admin: bookings ----------------------------------------------------

async function handleAdminApprove(request, env, pathname) {
  const id = pathname.split("/")[4];
  const booking = await getBooking(env, id);
  if (!booking) return json({ error: "Not found" }, 404);

  const body = await request.json().catch(() => ({}));
  const expiryHours = Number(env.DEPOSIT_LINK_EXPIRY_HOURS || 72);
  const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString();

  const extra = { deposit_link_expires_at: expiresAt };
  // Lets the admin correct the total (e.g. quoted/custom-menu items) before
  // the deposit is calculated, rather than being stuck with the
  // auto-computed total from priced menu items alone.
  if (body.override_total_cents != null) {
    const total = Number(body.override_total_cents);
    const depositPercent = booking.deposit_percent || Number(env.DEPOSIT_PERCENT || 50);
    extra.order_total_cents = total;
    extra.deposit_amount_cents = Math.round((total * depositPercent) / 100);
  }

  await updateBookingStatus(env, id, "approved", extra);
  const updated = await getBooking(env, id);

  const checkoutPageUrl = `${env.SITE_URL}/booking/checkout/?booking=${id}`;
  await sendEmail(env, {
    to: updated.email,
    subject: `You're approved for ${updated.event_date}! Next step: deposit`,
    html: bookingApprovedEmailToCustomer(env, updated, checkoutPageUrl),
  });

  return json({ ok: true, checkout_page_url: checkoutPageUrl });
}

async function handleAdminReject(env, pathname) {
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

async function handleAdminResendDepositLink(env, pathname) {
  const id = pathname.split("/")[4];
  const booking = await getBooking(env, id);
  if (!booking) return json({ error: "Not found" }, 404);

  const expiryHours = Number(env.DEPOSIT_LINK_EXPIRY_HOURS || 72);
  const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString();
  await updateBookingStatus(env, id, "approved", { deposit_link_expires_at: expiresAt });
  const updated = await getBooking(env, id);

  const checkoutPageUrl = `${env.SITE_URL}/booking/checkout/?booking=${id}`;
  await sendEmail(env, {
    to: updated.email,
    subject: `Your deposit link — ${updated.event_date}`,
    html: bookingApprovedEmailToCustomer(env, updated, checkoutPageUrl),
  });

  return json({ ok: true });
}

async function handleAdminAddBlockedDate(request, env) {
  const body = await request.json().catch(() => null);
  if (!body?.date || !isValidDateString(body.date)) return badRequest("Invalid date");
  await env.DB.prepare(
    "INSERT OR REPLACE INTO blocked_dates (date, reason, source) VALUES (?, ?, 'manual')"
  )
    .bind(body.date, body.reason || null)
    .run();
  return json({ ok: true });
}

// ---- admin: lunch-sale events ----------------------------------------------

async function handleAdminCreateLunchSaleEvent(request, env) {
  const body = await request.json().catch(() => null);
  if (!body) return badRequest("Invalid JSON body");
  const { title, menu_description, price_cents, dropoff_options, sale_date, order_cutoff_at, slot_cap } =
    body;
  if (!title || !menu_description || !price_cents || !dropoff_options?.length || !sale_date || !order_cutoff_at || !slot_cap) {
    return badRequest("Missing required fields");
  }

  const event = {
    id: newId(),
    title,
    menu_description,
    price_cents: Number(price_cents),
    dropoff_options,
    sale_date,
    order_cutoff_at,
    slot_cap: Number(slot_cap),
    max_qty_per_order: Number(body.max_qty_per_order || 10),
    status: body.status === "live" ? "live" : "draft",
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  await insertLunchSaleEvent(env, event);
  return json({ ok: true, event });
}

async function handleAdminUpdateLunchSaleEvent(request, env, pathname) {
  const id = pathname.split("/")[5];
  const body = await request.json().catch(() => null);
  if (!body) return badRequest("Invalid JSON body");

  const allowed = [
    "title",
    "menu_description",
    "price_cents",
    "dropoff_options",
    "sale_date",
    "order_cutoff_at",
    "slot_cap",
    "max_qty_per_order",
    "status",
  ];
  const fields = {};
  for (const k of allowed) if (body[k] !== undefined) fields[k] = body[k];
  if (!Object.keys(fields).length) return badRequest("Nothing to update");

  await updateLunchSaleEvent(env, id, fields);
  return json({ ok: true, event: await getLunchSaleEvent(env, id) });
}

async function handleAdminNotifySignups(env, pathname) {
  const id = pathname.split("/")[5];
  const event = await getLunchSaleEvent(env, id);
  if (!event) return json({ error: "Not found" }, 404);

  const signups = await listLunchSaleSignups(env);
  const results = await Promise.allSettled(
    signups.map((s) =>
      sendEmail(env, {
        to: s.email,
        subject: `${event.title} is open!`,
        html: lunchSaleNowLiveEmail(env, event),
      })
    )
  );
  const sent = results.filter((r) => r.status === "fulfilled").length;
  return json({ ok: true, sent, total: signups.length });
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
    const kind = session.metadata?.kind;

    if (kind === "lunch_sale") {
      await handleLunchSalePaid(env, session);
    } else {
      await handleDepositPaid(env, session);
    }
  }

  return json({ received: true });
}

async function handleDepositPaid(env, session) {
  const bookingId = session.client_reference_id;
  const booking = bookingId
    ? await getBooking(env, bookingId)
    : await findBookingByStripeSession(env, session.id);
  if (!booking || booking.status === "confirmed") return;

  await updateBookingStatus(env, booking.id, "confirmed", {
    stripe_payment_status: "paid",
  });
  const confirmed = await getBooking(env, booking.id);

  const calendarEventId = await pushBookingToCalendar(env, confirmed).catch((err) => {
    console.error("[calendar] push failed", err);
    return null;
  });
  if (calendarEventId) {
    await updateBookingStatus(env, booking.id, "confirmed", {
      google_calendar_event_id: calendarEventId,
    });
  }

  await sendEmail(env, {
    to: confirmed.email,
    subject: `Deposit received — ${confirmed.event_date} is booked!`,
    html: depositConfirmedEmail(env, confirmed),
  });
  await sendEmail(env, {
    to: env.CLIENT_NOTIFY_EMAIL,
    subject: `Deposit paid — ${confirmed.event_date} (${confirmed.name})`,
    html: `<p>${confirmed.name} paid their deposit for ${confirmed.event_date}. Booking confirmed.</p>`,
  });
}

async function handleLunchSalePaid(env, session) {
  const orderId = session.metadata?.lunch_sale_order_id || session.client_reference_id;
  const order = orderId
    ? await getLunchSaleOrder(env, orderId)
    : await findLunchSaleOrderByStripeSession(env, session.id);
  if (!order || order.status === "paid") return;

  await updateLunchSaleOrderStatus(env, order.id, "paid", { stripe_payment_status: "paid" });
  const event = await getLunchSaleEvent(env, order.event_id);
  const paidOrder = await getLunchSaleOrder(env, order.id);

  await sendEmail(env, {
    to: paidOrder.email,
    subject: `Order confirmed — ${event.title}`,
    html: lunchSaleOrderConfirmedEmail(env, paidOrder, event),
  });
}
