// Deposit checkout — embedded Stripe Payment Element + Express Checkout
// Element (Apple Pay / Google Pay / Link), right on this page. This page
// itself stays valid for the full DEPOSIT_LINK_EXPIRY_HOURS window (see
// README) — the PaymentIntent backing the Elements is only created the
// moment this page loads (and reused on reload), since a PaymentIntent
// isn't meant to sit around unused for days the way our own link is.

let currentBooking = null;
let stripe = null;
let elements = null;
let checkoutEmail = "";

const BRAND_APPEARANCE = {
  theme: "stripe",
  variables: {
    colorPrimary: "#b6862f",
    colorBackground: "#ffffff",
    colorText: "#201c14",
    colorDanger: "#7a2e2e",
    fontFamily: "'Work Sans', sans-serif",
    borderRadius: "6px",
  },
};

document.addEventListener("DOMContentLoaded", async () => {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("booking");
  const summary = document.getElementById("summaryText");
  const payCard = document.getElementById("payCard");
  const expiredCard = document.getElementById("expiredCard");
  const notFound = document.getElementById("notFoundCard");

  if (!id) {
    notFound.style.display = "block";
    return;
  }

  let info;
  try {
    const res = await fetch(`/api/booking/${id}/checkout-info`);
    if (!res.ok) throw new Error("not found");
    info = await res.json();
  } catch {
    summary.textContent = "";
    notFound.style.display = "block";
    return;
  }
  currentBooking = info;

  if (info.status === "confirmed") {
    window.location.href = `/booking/?paid=1&booking=${id}`;
    return;
  }
  if (info.status !== "approved") {
    summary.textContent = "";
    notFound.style.display = "block";
    return;
  }
  if (info.expired) {
    summary.textContent = "";
    expiredCard.style.display = "block";
    return;
  }

  summary.textContent = `${info.name}, review your order below and pay your deposit to lock in ${formatDate(
    info.event_date
  )}.`;

  document.getElementById("orderSummary").innerHTML = `
    <div class="line">Order total<span>$${((info.order_total_cents || 0) / 100).toFixed(2)}</span></div>
    <div class="total">Deposit due now (${info.deposit_percent || 50}%)<span>$${(
      (info.deposit_amount_cents || 0) / 100
    ).toFixed(2)}</span></div>`;

  const params2 = new URLSearchParams(window.location.search);
  if (params2.get("canceled") === "1") {
    document.getElementById("payNote").textContent =
      "Payment was canceled — no charge was made. You can try again below whenever you're ready.";
  }

  payCard.style.display = "block";
  await initStripe(id);
});

async function initStripe(bookingId) {
  const loadingEl = document.getElementById("stripeLoading");
  try {
    const res = await fetch(`/api/booking/${bookingId}/payment-intent`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      loadingEl.textContent = data.error || "Could not start payment — please refresh and try again.";
      return;
    }

    stripe = Stripe(data.publishable_key);
    checkoutEmail = currentBooking.email || "";
    elements = stripe.elements({ clientSecret: data.client_secret, appearance: BRAND_APPEARANCE });

    const expressCheckoutElement = elements.create("expressCheckout");
    expressCheckoutElement.mount("#expressCheckoutElement");
    expressCheckoutElement.on("ready", ({ availablePaymentMethods }) => {
      if (availablePaymentMethods) document.getElementById("stripeDivider").style.display = "flex";
    });
    expressCheckoutElement.on("confirm", () => confirmPayment(bookingId));

    const linkAuthEl = elements.create("linkAuthentication", {
      defaultValues: { email: checkoutEmail },
    });
    linkAuthEl.mount("#linkAuthenticationElement");
    linkAuthEl.on("change", (e) => {
      checkoutEmail = e.value.email;
    });

    const paymentElement = elements.create("payment");
    paymentElement.mount("#paymentElement");

    loadingEl.style.display = "none";
    document.getElementById("paymentForm").style.display = "block";
    document.getElementById("paymentForm").addEventListener("submit", (e) => {
      e.preventDefault();
      confirmPayment(bookingId);
    });
  } catch (err) {
    console.error(err);
    loadingEl.textContent = "Could not start payment — please refresh and try again.";
  }
}

async function confirmPayment(bookingId) {
  const btn = document.getElementById("payBtn");
  const msgEl = document.getElementById("paymentMessage");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Processing…";
  }

  const { error, paymentIntent } = await stripe.confirmPayment({
    elements,
    confirmParams: {
      return_url: `${window.location.origin}/booking/?paid=1&booking=${bookingId}`,
      receipt_email: checkoutEmail || undefined,
    },
    redirect: "if_required",
  });

  if (error) {
    showMsg(msgEl, "error", error.message || "Payment failed — please try again.");
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Pay Deposit Securely";
    }
    return;
  }

  if (paymentIntent && ["succeeded", "processing"].includes(paymentIntent.status)) {
    window.location.href = `/booking/?paid=1&booking=${bookingId}`;
  }
}

function showMsg(el, type, text) {
  el.className = `form-msg show ${type}`;
  el.textContent = text;
}

function formatDate(dateStr) {
  try {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  } catch {
    return dateStr;
  }
}
