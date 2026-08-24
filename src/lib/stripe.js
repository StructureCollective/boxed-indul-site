// Minimal Stripe REST client using fetch — no Node SDK dependency, so it
// runs natively on the Workers runtime without extra compat flags.
// Use TEST MODE keys (sk_test_...) for this mockup.
// Set via: wrangler secret put STRIPE_SECRET_KEY

const STRIPE_API = "https://api.stripe.com/v1";

// Stripe Checkout Sessions cap expires_at at 24h from creation and require
// at least 30 minutes. Our deposit links can stay "alive" on our own site
// for much longer (see DEPOSIT_LINK_EXPIRY_HOURS) because the Stripe
// session itself is only created the moment the customer clicks "Pay" on
// our page — not at approval time. This just clamps whatever's left of our
// longer window into Stripe's allowed range.
const STRIPE_MIN_EXPIRY_SECONDS = 30 * 60;
const STRIPE_MAX_EXPIRY_SECONDS = 24 * 60 * 60;

function formBody(obj, prefix = "") {
  const params = new URLSearchParams();
  function walk(o, p) {
    for (const [k, v] of Object.entries(o)) {
      const key = p ? `${p}[${k}]` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) {
        walk(v, key);
      } else {
        params.append(key, v);
      }
    }
  }
  walk(obj, prefix);
  return params;
}

async function stripeRequest(env, path, body) {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formBody(body),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error("[stripe] error", res.status, data);
    throw new Error(data?.error?.message || `Stripe request failed (${res.status})`);
  }
  return data;
}

// Creates a fresh Checkout Session for a booking's deposit, right when the
// customer clicks "Pay Deposit" on our own /booking/checkout/ page (not at
// admin-approval time — that page just links there any time before
// booking.deposit_link_expires_at).
export async function createDepositCheckoutSession(env, booking) {
  const secondsUntilOurExpiry = booking.deposit_link_expires_at
    ? Math.floor((new Date(booking.deposit_link_expires_at).getTime() - Date.now()) / 1000)
    : STRIPE_MAX_EXPIRY_SECONDS;
  const expiresInSeconds = Math.max(
    STRIPE_MIN_EXPIRY_SECONDS,
    Math.min(STRIPE_MAX_EXPIRY_SECONDS, secondsUntilOurExpiry)
  );
  const expiresAtUnix = Math.floor(Date.now() / 1000) + expiresInSeconds;

  return stripeRequest(env, "/checkout/sessions", {
    mode: "payment",
    success_url: `${env.SITE_URL}/booking/?paid=1&booking=${booking.id}`,
    cancel_url: `${env.SITE_URL}/booking/checkout/?booking=${booking.id}&canceled=1`,
    customer_email: booking.email,
    client_reference_id: booking.id,
    expires_at: expiresAtUnix,
    line_items: {
      0: {
        price_data: {
          currency: env.DEPOSIT_CURRENCY || "usd",
          unit_amount: booking.deposit_amount_cents,
          product_data: {
            name: `${env.BUSINESS_NAME} — Order deposit (${booking.event_date})`,
            description: `${booking.deposit_percent || ""}% deposit to reserve ${booking.guest_count} boxes for delivery on ${booking.event_date}`,
          },
        },
        quantity: 1,
      },
    },
    metadata: {
      booking_id: booking.id,
      kind: "deposit",
    },
  });
}

// Full-payment checkout for a lunch-sale order (no deposit split — this is
// a direct sale, paid in full at checkout).
export async function createLunchSaleCheckoutSession(env, order, event) {
  return stripeRequest(env, "/checkout/sessions", {
    mode: "payment",
    success_url: `${env.SITE_URL}/lunch-sale/?paid=1&order=${order.id}`,
    cancel_url: `${env.SITE_URL}/lunch-sale/?canceled=1&order=${order.id}`,
    customer_email: order.email,
    client_reference_id: order.id,
    line_items: {
      0: {
        price_data: {
          currency: env.DEPOSIT_CURRENCY || "usd",
          unit_amount: event.price_cents,
          product_data: {
            name: `${event.title} — ${order.dropoff_choice}`,
            description: `${order.quantity} lunch(es) for ${event.sale_date}`,
          },
        },
        quantity: order.quantity,
      },
    },
    metadata: {
      lunch_sale_order_id: order.id,
      event_id: event.id,
      kind: "lunch_sale",
    },
  });
}

// Verifies the Stripe-Signature header using HMAC-SHA256, per Stripe's
// documented webhook signing scheme — implemented with Web Crypto since the
// Node 'stripe' SDK's helper isn't available in the Workers runtime.
export async function verifyStripeWebhook(payloadText, signatureHeader, secret) {
  if (!signatureHeader) return false;
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((p) => p.split("="))
  );
  const timestamp = parts["t"];
  const signature = parts["v1"];
  if (!timestamp || !signature) return false;

  const signedPayload = `${timestamp}.${payloadText}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signedPayload)
  );
  const expected = [...new Uint8Array(sigBuffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return expected === signature;
}
