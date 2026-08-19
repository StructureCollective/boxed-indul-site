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

export async function createDepositCheckoutSession(env, booking) {
  return stripeRequest(env, "/checkout/sessions", {
    mode: "payment",
    success_url: `${env.SITE_URL}/booking/?paid=1&booking=${booking.id}`,
    cancel_url: `${env.SITE_URL}/booking/?canceled=1&booking=${booking.id}`,
    customer_email: booking.email,
    client_reference_id: booking.id,
    line_items: {
      0: {
        price_data: {
          currency: env.DEPOSIT_CURRENCY || "usd",
          unit_amount: booking.deposit_amount_cents,
          product_data: {
            name: `${env.BUSINESS_NAME} — Order deposit (${booking.event_date})`,
            description: `Deposit to reserve ${booking.guest_count} boxes for delivery on ${booking.event_date}`,
          },
        },
        quantity: 1,
      },
    },
    metadata: {
      booking_id: booking.id,
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
