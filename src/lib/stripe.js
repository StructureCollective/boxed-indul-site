// Minimal Stripe REST client using fetch — no Node SDK dependency, so it
// runs natively on the Workers runtime without extra compat flags.
// Use TEST MODE keys (sk_test_...) for this mockup.
// Set via: wrangler secret put STRIPE_SECRET_KEY

const STRIPE_API = "https://api.stripe.com/v1";

function formBody(obj, prefix = "") {
  const params = new URLSearchParams();
  function walk(o, p) {
    for (const [k, v] of Object.entries(o)) {
      const key = p ? `${p}[${k}]` : k;
      if (Array.isArray(v)) {
        // Stripe's form encoding for list params (e.g. payment_method_types)
        // is indexed brackets: key[0]=a&key[1]=b — plain URLSearchParams
        // would otherwise stringify the whole array into one value.
        v.forEach((item, i) => {
          const arrKey = `${key}[${i}]`;
          if (item && typeof item === "object") {
            walk(item, arrKey);
          } else {
            params.append(arrKey, item);
          }
        });
      } else if (v && typeof v === "object") {
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

async function stripeGet(env, path) {
  const res = await fetch(`${STRIPE_API}${path}`, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  const data = await res.json();
  if (!res.ok) {
    console.error("[stripe] error", res.status, data);
    throw new Error(data?.error?.message || `Stripe request failed (${res.status})`);
  }
  return data;
}

// Both checkout flows are embedded directly on our own pages using Stripe
// Elements (Payment Element + Express Checkout Element for Apple Pay/Google
// Pay, plus a Link Authentication Element to collect/confirm the customer's
// email right at checkout) — no redirect to a Stripe-hosted page. A
// PaymentIntent (not a Checkout Session) backs this: the client mounts
// Elements with the PaymentIntent's client_secret, then calls
// stripe.confirmPayment() itself.
//
// PAYMENT_METHOD_TYPES pins the exact list of methods offered, instead of
// automatic_payment_methods (which shows whatever's toggled on in the
// Stripe Dashboard). Card covers Apple Pay/Google Pay automatically in
// browsers/devices that support them via the Express Checkout Element —
// there's no separate "apple_pay" type to request. Klarna, Affirm, Amazon
// Pay, and Link are deliberately left out here regardless of what's enabled
// in the Dashboard.
const PAYMENT_METHOD_TYPES = ["card", "cashapp"];

// Creates a fresh PaymentIntent for a booking's deposit, the moment the
// customer's /booking/checkout/ page loads (not at admin-approval time —
// that page is just a durable link, valid for the full
// DEPOSIT_LINK_EXPIRY_HOURS window even though a single PaymentIntent isn't
// meant to live that long; see handleCreateDepositPaymentIntent in
// index.js, which reuses/recreates the PaymentIntent as needed).
export async function createDepositPaymentIntent(env, booking) {
  return stripeRequest(env, "/payment_intents", {
    amount: booking.deposit_amount_cents,
    currency: env.DEPOSIT_CURRENCY || "usd",
    payment_method_types: PAYMENT_METHOD_TYPES,
    receipt_email: booking.email,
    description: `${env.BUSINESS_NAME} — Order deposit (${booking.event_date})`,
    metadata: {
      booking_id: booking.id,
      kind: "deposit",
    },
  });
}

// Full-payment PaymentIntent for a lunch-sale order (no deposit split —
// this is a direct sale, paid in full at checkout).
export async function createLunchSalePaymentIntent(env, order, event) {
  return stripeRequest(env, "/payment_intents", {
    amount: order.total_cents,
    currency: env.DEPOSIT_CURRENCY || "usd",
    payment_method_types: PAYMENT_METHOD_TYPES,
    receipt_email: order.email,
    description: `${event.title} — ${order.dropoff_choice}`,
    metadata: {
      lunch_sale_order_id: order.id,
      event_id: event.id,
      kind: "lunch_sale",
    },
  });
}

export async function retrievePaymentIntent(env, id) {
  return stripeGet(env, `/payment_intents/${id}`);
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
