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
  findBookingByPaymentIntent,
  insertLunchSaleEvent,
  updateLunchSaleEvent,
  deleteLunchSaleEvent,
  countLunchSaleOrdersForEvent,
  getLunchSaleEvent,
  getCurrentLiveLunchSaleEvent,
  listAllLunchSaleEvents,
  insertLunchSaleOrder,
  updateLunchSaleOrderStatus,
  getLunchSaleOrder,
  findLunchSaleOrderByPaymentIntent,
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
  lunchSalePaymentLinkEmail,
  lunchSaleSignupConfirmedEmail,
  lunchSaleNowLiveEmail,
} from "./lib/email.js";
import {
  createDepositPaymentIntent,
  createLunchSalePaymentIntent,
  retrievePaymentIntent,
  verifyStripeWebhook,
} from "./lib/stripe.js";
import {
  priceOrder,
  loadOrderMenus,
  saveOrderMenus,
  loadOccasions,
  saveOccasions,
  invalidateMenuCache,
} from "./lib/menu-data.js";
import { verifyAccessJwt } from "./lib/access.js";
import {
  buildGoogleAuthUrl,
  exchangeCodeForTokens,
  getConnectedEmail,
  pushBookingToCalendar,
  syncBusyDatesFromCalendar,
} from "./lib/calendar.js";

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
      if (pathname === "/api/order-menus" && request.method === "GET") {
        return json({ order_menus: await loadOrderMenus(env) });
      }
      if (pathname === "/api/occasions" && request.method === "GET") {
        return json({ occasions: await loadOccasions(env) });
      }
      if (pathname.match(/^\/api\/booking\/[^/]+\/checkout-info$/) && request.method === "GET") {
        return handleBookingCheckoutInfo(env, pathname);
      }
      if (
        pathname.match(/^\/api\/booking\/[^/]+\/payment-intent$/) &&
        request.method === "POST"
      ) {
        return handleCreateDepositPaymentIntent(env, pathname);
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
      if (
        pathname.match(/^\/api\/lunch-sale\/order\/[^/]+\/checkout-info$/) &&
        request.method === "GET"
      ) {
        return handleLunchSaleOrderCheckoutInfo(env, pathname);
      }
      if (
        pathname.match(/^\/api\/lunch-sale\/order\/[^/]+\/payment-intent$/) &&
        request.method === "POST"
      ) {
        return handleLunchSaleOrderPaymentIntent(env, pathname);
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
  if (
    pathname.match(/^\/api\/admin\/lunch-sale\/events\/[^/]+$/) &&
    request.method === "DELETE"
  ) {
    return handleAdminDeleteLunchSaleEvent(env, pathname);
  }
  if (pathname === "/api/admin/lunch-sale/orders" && request.method === "GET") {
    return json({ orders: await listAllLunchSaleOrders(env) });
  }
  if (
    pathname.match(/^\/api\/admin\/lunch-sale\/orders\/[^/]+\/resend-payment-link$/) &&
    request.method === "POST"
  ) {
    return handleAdminResendLunchSalePaymentLink(env, pathname);
  }
  if (pathname === "/api/admin/lunch-sale/signups" && request.method === "GET") {
    return json({ signups: await listLunchSaleSignups(env) });
  }

  // ---- menus & occasions admin (site_settings) ----
  if (pathname === "/api/admin/order-menus" && request.method === "GET") {
    return json({ order_menus: await loadOrderMenus(env) });
  }
  if (pathname === "/api/admin/order-menus" && request.method === "PUT") {
    return handleAdminUpdateOrderMenus(request, env);
  }
  if (pathname === "/api/admin/occasions" && request.method === "GET") {
    return json({ occasions: await loadOccasions(env) });
  }
  if (pathname === "/api/admin/occasions" && request.method === "PUT") {
    return handleAdminUpdateOccasions(request, env);
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
  const occasions = await loadOccasions(env);
  if (!occasions.some((o) => o.value === event_type)) return badRequest("Invalid event_type");
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
    email: booking.email,
    event_date: booking.event_date,
    guest_count: booking.guest_count,
    order_total_cents: booking.order_total_cents,
    deposit_amount_cents: booking.deposit_amount_cents,
    deposit_percent: booking.deposit_percent,
    status: booking.status,
    expired: !!expired,
  });
}

// Creates (or reuses) the PaymentIntent backing the embedded Payment Element
// + Express Checkout Element on /booking/checkout/. Reused across page
// reloads so a customer bouncing off and back doesn't rack up abandoned
// PaymentIntents; recreated if the prior one is no longer usable (canceled,
// already succeeded) or the amount changed (e.g. admin edited the total).
async function handleCreateDepositPaymentIntent(env, pathname) {
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

  let intent = booking.stripe_payment_intent_id
    ? await retrievePaymentIntent(env, booking.stripe_payment_intent_id).catch(() => null)
    : null;
  const needsNew =
    !intent ||
    ["canceled", "succeeded"].includes(intent.status) ||
    intent.amount !== booking.deposit_amount_cents;

  if (needsNew) {
    intent = await createDepositPaymentIntent(env, booking);
    await updateBookingStatus(env, id, "approved", {
      stripe_payment_intent_id: intent.id,
    });
  }

  return json({
    client_secret: intent.client_secret,
    publishable_key: env.STRIPE_PUBLISHABLE_KEY,
    amount: booking.deposit_amount_cents,
    currency: env.DEPOSIT_CURRENCY || "usd",
  });
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

  const intent = await createLunchSalePaymentIntent(env, order, event);
  await updateLunchSaleOrderStatus(env, order.id, "pending_payment", {
    stripe_payment_intent_id: intent.id,
  });

  await sendEmail(env, {
    to: env.CLIENT_NOTIFY_EMAIL,
    subject: `New lunch-sale order — ${event.title}`,
    html: lunchSaleOrderReceivedEmailToClient(env, order, event),
    replyTo: email,
  });

  return json({
    ok: true,
    order_id: order.id,
    client_secret: intent.client_secret,
    publishable_key: env.STRIPE_PUBLISHABLE_KEY,
    amount: order.total_cents,
    currency: env.DEPOSIT_CURRENCY || "usd",
  });
}

// Public info for the /lunch-sale/checkout/ page — used both when a
// customer bounces off mid-payment and comes back, and when the admin
// resends a payment link for an order that never got paid.
async function handleLunchSaleOrderCheckoutInfo(env, pathname) {
  const id = pathname.split("/")[4];
  const order = await getLunchSaleOrder(env, id);
  if (!order) return json({ error: "Not found" }, 404);
  const event = await getLunchSaleEvent(env, order.event_id);

  return json({
    id: order.id,
    name: order.name,
    email: order.email,
    quantity: order.quantity,
    dropoff_choice: order.dropoff_choice,
    total_cents: order.total_cents,
    status: order.status,
    event_title: event?.title || null,
    event_cutoff_passed: event ? new Date(event.order_cutoff_at).getTime() < Date.now() : true,
  });
}

// Creates (or reuses) the PaymentIntent for an existing lunch-sale order —
// mirrors handleCreateDepositPaymentIntent's reuse/recreate logic for
// bookings. Lets a customer resume payment (or the admin resend a link)
// without spawning a fresh PaymentIntent every time the page loads.
async function handleLunchSaleOrderPaymentIntent(env, pathname) {
  const id = pathname.split("/")[4];
  const order = await getLunchSaleOrder(env, id);
  if (!order) return json({ error: "Not found" }, 404);
  if (order.status !== "pending_payment") {
    return json({ error: "This order isn't awaiting payment." }, 409);
  }
  const event = await getLunchSaleEvent(env, order.event_id);
  if (!event) return json({ error: "Not found" }, 404);
  if (new Date(event.order_cutoff_at).getTime() < Date.now()) {
    return json({ error: "Ordering has closed for this lunch sale." }, 410);
  }

  let intent = order.stripe_payment_intent_id
    ? await retrievePaymentIntent(env, order.stripe_payment_intent_id).catch(() => null)
    : null;
  const needsNew =
    !intent || ["canceled", "succeeded"].includes(intent.status) || intent.amount !== order.total_cents;

  if (needsNew) {
    intent = await createLunchSalePaymentIntent(env, order, event);
    await updateLunchSaleOrderStatus(env, id, "pending_payment", {
      stripe_payment_intent_id: intent.id,
    });
  }

  return json({
    client_secret: intent.client_secret,
    publishable_key: env.STRIPE_PUBLISHABLE_KEY,
    amount: order.total_cents,
    currency: env.DEPOSIT_CURRENCY || "usd",
  });
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
    image_url: body.image_url || null,
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
    "image_url",
  ];
  const fields = {};
  for (const k of allowed) if (body[k] !== undefined) fields[k] = body[k];
  if (!Object.keys(fields).length) return badRequest("Nothing to update");

  await updateLunchSaleEvent(env, id, fields);
  return json({ ok: true, event: await getLunchSaleEvent(env, id) });
}

async function handleAdminDeleteLunchSaleEvent(env, pathname) {
  const id = pathname.split("/")[5];
  const event = await getLunchSaleEvent(env, id);
  if (!event) return json({ error: "Event not found." }, 404);

  const orderCount = await countLunchSaleOrdersForEvent(env, id);
  if (orderCount > 0) {
    return json(
      {
        error: `Can't delete — ${orderCount} order${
          orderCount === 1 ? "" : "s"
        } are on file for this event. Cancel it instead to keep the order history intact.`,
      },
      400
    );
  }

  await deleteLunchSaleEvent(env, id);
  return json({ ok: true });
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

async function handleAdminResendLunchSalePaymentLink(env, pathname) {
  const id = pathname.split("/")[5];
  const order = await getLunchSaleOrder(env, id);
  if (!order) return json({ error: "Not found" }, 404);
  if (order.status !== "pending_payment") {
    return json({ error: "This order is already paid or no longer awaiting payment." }, 400);
  }
  const event = await getLunchSaleEvent(env, order.event_id);
  if (!event) return json({ error: "Event not found." }, 404);
  if (new Date(event.order_cutoff_at).getTime() < Date.now()) {
    return json(
      { error: "Ordering has closed for this lunch sale — cancel this order instead of resending a link." },
      410
    );
  }

  const checkoutPageUrl = `${env.SITE_URL}/lunch-sale/checkout/?order=${id}`;
  await sendEmail(env, {
    to: order.email,
    subject: `Your payment link — ${event.title}`,
    html: lunchSalePaymentLinkEmail(env, order, event, checkoutPageUrl),
  });

  return json({ ok: true, checkout_page_url: checkoutPageUrl });
}

// ---- menus & occasions admin -----------------------------------------------

const REQUIRED_ORDER_MENU_KEYS = ["boxed_lunch", "charcuterie", "custom_meal"];

// Order menus drive real checkout pricing, so this validates the shape
// before saving rather than trusting whatever the admin UI sends — a
// malformed save here would break every order/quote on the site.
function validateOrderMenus(menus) {
  if (!menus || typeof menus !== "object") return "Menus must be an object.";
  for (const key of REQUIRED_ORDER_MENU_KEYS) {
    if (!menus[key] || typeof menus[key] !== "object") return `Missing "${key}" category.`;
  }
  const itemListKeys = {
    boxed_lunch: ["entrees", "enhancements"],
    charcuterie: ["boards", "enhancements"],
    custom_meal: ["boxes", "personalization"],
  };
  for (const [category, listKeys] of Object.entries(itemListKeys)) {
    const menu = menus[category];
    for (const listKey of listKeys) {
      const list = menu[listKey];
      if (!Array.isArray(list)) return `"${category}.${listKey}" must be a list.`;
      for (const item of list) {
        if (!item || typeof item !== "object") return `Invalid item in "${category}.${listKey}".`;
        if (!item.id || typeof item.id !== "string") return `Every item in "${category}.${listKey}" needs an id.`;
        if (!item.name || typeof item.name !== "string")
          return `Every item in "${category}.${listKey}" needs a name.`;
        if (item.quoted) continue; // custom_meal.personalization items are priced by quote, not a fixed amount
        if (typeof item.price_cents !== "number" || item.price_cents < 0 || !Number.isFinite(item.price_cents)) {
          return `"${item.name}" in "${category}.${listKey}" needs a valid price.`;
        }
      }
    }
  }
  return null;
}

function validateOccasions(occasions) {
  if (!Array.isArray(occasions) || !occasions.length) return "Occasions must be a non-empty list.";
  const seen = new Set();
  for (const o of occasions) {
    if (!o || typeof o !== "object") return "Invalid occasion entry.";
    if (!o.value || typeof o.value !== "string") return "Every occasion needs a value.";
    if (!o.label || typeof o.label !== "string") return "Every occasion needs a label.";
    if (seen.has(o.value)) return `Duplicate occasion value "${o.value}".`;
    seen.add(o.value);
  }
  return null;
}

async function handleAdminUpdateOrderMenus(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || !body.order_menus) return badRequest("Missing order_menus");

  const error = validateOrderMenus(body.order_menus);
  if (error) return badRequest(error);

  await saveOrderMenus(env, body.order_menus);
  invalidateMenuCache();
  return json({ ok: true, order_menus: body.order_menus });
}

async function handleAdminUpdateOccasions(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || !body.occasions) return badRequest("Missing occasions");

  const error = validateOccasions(body.occasions);
  if (error) return badRequest(error);

  await saveOccasions(env, body.occasions);
  invalidateMenuCache();
  return json({ ok: true, occasions: body.occasions });
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

  // The embedded Payment/Express Checkout Element flow confirms a
  // PaymentIntent directly (no Checkout Session involved), so that's the
  // event we listen for — configure this in the Stripe webhook endpoint's
  // event list.
  if (event.type === "payment_intent.succeeded") {
    const intent = event.data.object;
    const kind = intent.metadata?.kind;

    if (kind === "lunch_sale") {
      await handleLunchSalePaid(env, intent);
    } else if (kind === "deposit") {
      await handleDepositPaid(env, intent);
    }
  }

  return json({ received: true });
}

async function handleDepositPaid(env, intent) {
  const bookingId = intent.metadata?.booking_id;
  const booking = bookingId
    ? await getBooking(env, bookingId)
    : await findBookingByPaymentIntent(env, intent.id);
  if (!booking || booking.status === "confirmed") return;

  // The Link Authentication Element on the checkout page lets the customer
  // confirm/correct their email right at payment time — trust that over
  // whatever was typed into the original request form, since it's what
  // Stripe's own receipt (and our confirmation email) actually went to.
  const extra = { stripe_payment_status: "paid" };
  if (intent.receipt_email && intent.receipt_email !== booking.email) {
    extra.email = intent.receipt_email;
  }
  await updateBookingStatus(env, booking.id, "confirmed", extra);
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

async function handleLunchSalePaid(env, intent) {
  const orderId = intent.metadata?.lunch_sale_order_id;
  const order = orderId
    ? await getLunchSaleOrder(env, orderId)
    : await findLunchSaleOrderByPaymentIntent(env, intent.id);
  if (!order || order.status === "paid") return;

  const extra = { stripe_payment_status: "paid" };
  if (intent.receipt_email && intent.receipt_email !== order.email) {
    extra.email = intent.receipt_email;
  }
  await updateLunchSaleOrderStatus(env, order.id, "paid", extra);
  const event = await getLunchSaleEvent(env, order.event_id);
  const paidOrder = await getLunchSaleOrder(env, order.id);

  await sendEmail(env, {
    to: paidOrder.email,
    subject: `Order confirmed — ${event.title}`,
    html: lunchSaleOrderConfirmedEmail(env, paidOrder, event),
  });
  await sendEmail(env, {
    to: env.CLIENT_NOTIFY_EMAIL,
    subject: `Lunch order paid — ${event.title} (${paidOrder.name})`,
    html: `<p>${paidOrder.name} paid for their lunch order — ${paidOrder.quantity} × ${event.title}, $${(
      paidOrder.total_cents / 100
    ).toFixed(2)} total. Drop-off: ${paidOrder.dropoff_choice}.</p>`,
  });
}
