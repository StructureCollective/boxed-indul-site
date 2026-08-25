// Lunch-sale order payment page (/lunch-sale/checkout/?order=<id>) — used
// when a customer bounces off the inline payment step on /lunch-sale/ and
// needs to come back, or when the admin resends a payment link for an
// order stuck in pending_payment. Mirrors public/js/checkout.js's embedded
// Stripe Payment Element + Express Checkout Element pattern.

let currentOrder = null;
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
  const id = params.get("order");
  const summary = document.getElementById("summaryText");
  const payCard = document.getElementById("payCard");
  const paidCard = document.getElementById("paidCard");
  const closedCard = document.getElementById("closedCard");
  const notFound = document.getElementById("notFoundCard");

  if (!id) {
    notFound.style.display = "block";
    return;
  }

  let info;
  try {
    const res = await fetch(`/api/lunch-sale/order/${id}/checkout-info`);
    if (!res.ok) throw new Error("not found");
    info = await res.json();
  } catch {
    summary.textContent = "";
    notFound.style.display = "block";
    return;
  }
  currentOrder = info;

  if (info.status === "paid") {
    summary.textContent = "";
    paidCard.style.display = "block";
    return;
  }
  if (info.status !== "pending_payment") {
    summary.textContent = "";
    notFound.style.display = "block";
    return;
  }
  if (info.event_cutoff_passed) {
    summary.textContent = "";
    closedCard.style.display = "block";
    return;
  }

  summary.textContent = `${info.name}, review your order below and pay to confirm your lunch${
    info.event_title ? ` for ${info.event_title}` : ""
  }.`;

  document.getElementById("orderSummary").innerHTML = `
    <div class="line">${escapeHtml(info.name)} — ${escapeHtml(String(info.quantity))} lunch(es)</div>
    <div class="line">${escapeHtml(info.dropoff_choice)}</div>
    <div class="total">Total due now<span>$${((info.total_cents || 0) / 100).toFixed(2)}</span></div>`;

  payCard.style.display = "block";
  await initStripe(id);
});

async function initStripe(orderId) {
  const loadingEl = document.getElementById("stripeLoading");
  try {
    const res = await fetch(`/api/lunch-sale/order/${orderId}/payment-intent`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      loadingEl.textContent = data.error || "Could not start payment — please refresh and try again.";
      return;
    }

    stripe = Stripe(data.publishable_key);
    checkoutEmail = currentOrder.email || "";
    elements = stripe.elements({ clientSecret: data.client_secret, appearance: BRAND_APPEARANCE });

    const expressCheckoutElement = elements.create("expressCheckout");
    expressCheckoutElement.mount("#expressCheckoutElement");
    expressCheckoutElement.on("ready", ({ availablePaymentMethods }) => {
      if (availablePaymentMethods) document.getElementById("stripeDivider").style.display = "flex";
    });
    expressCheckoutElement.on("confirm", () => confirmPayment(orderId));

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
      confirmPayment(orderId);
    });
  } catch (err) {
    console.error(err);
    loadingEl.textContent = "Could not start payment — please refresh and try again.";
  }
}

async function confirmPayment(orderId) {
  const btn = document.getElementById("payBtn");
  const msgEl = document.getElementById("paymentMessage");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Processing…";
  }

  const { error, paymentIntent } = await stripe.confirmPayment({
    elements,
    confirmParams: {
      return_url: `${window.location.origin}/lunch-sale/?paid=1&order=${orderId}`,
      receipt_email: checkoutEmail || undefined,
    },
    redirect: "if_required",
  });

  if (error) {
    showMsg(msgEl, "error", error.message || "Payment failed — please try again.");
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Pay Now";
    }
    return;
  }

  if (paymentIntent && ["succeeded", "processing"].includes(paymentIntent.status)) {
    window.location.href = `/lunch-sale/?paid=1&order=${orderId}`;
  }
}

function showMsg(el, type, text) {
  el.className = `form-msg show ${type}`;
  el.textContent = text;
}
