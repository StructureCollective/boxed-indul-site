// Lunch Sale order/signup page. Shows the live lunch_sale_events entry with
// a qty + drop-off order form, then an embedded Stripe Payment Element +
// Express Checkout Element (Apple Pay/Google Pay/Link) right on this page
// for full payment — or a "no upcoming sale" placeholder with a notify-me
// signup form when nothing's live.

let currentEvent = null;
let stripe = null;
let elements = null;
let checkoutEmail = "";
let currentOrderId = null;

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

document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  if (params.get("paid") === "1") {
    showBanner("success", "Payment received! Check your email for confirmation and drop-off details.");
  } else if (params.get("canceled") === "1") {
    showBanner("error", "Payment was canceled — no charge was made.");
  }
  loadEvent();
});

function showBanner(type, text) {
  const area = document.getElementById("lunchSaleArea");
  const banner = document.createElement("div");
  banner.className = `form-msg show ${type}`;
  banner.style.marginBottom = "20px";
  banner.textContent = text;
  area.parentNode.insertBefore(banner, area);
}

async function loadEvent() {
  const area = document.getElementById("lunchSaleArea");
  try {
    const res = await fetch("/api/lunch-sale/current");
    const data = await res.json();
    currentEvent = data.event;
  } catch (err) {
    console.error("Failed to load lunch sale", err);
    currentEvent = null;
  }

  if (!currentEvent) {
    renderNoSale(area);
  } else {
    renderOrderForm(area, currentEvent);
  }
}

function renderNoSale(area) {
  area.innerHTML = `
    <div class="lunch-none-card">
      <p style="margin:0 0 12px;font-weight:600;color:var(--black);">No upcoming sale at this time.</p>
      <p style="margin:0 0 24px;">Leave your email and we'll let you know the moment the next lunch sale opens.</p>
      <form class="form-card" id="signupForm" style="text-align:left;max-width:420px;margin:0 auto;">
        <div class="field">
          <label for="signupEmail">Email</label>
          <input type="email" id="signupEmail" name="email" required placeholder="you@example.com">
        </div>
        <button type="submit" class="btn btn-primary" id="signupBtn" style="width:100%;justify-content:center;">Get Notified</button>
        <div class="form-msg" id="signupMsg"></div>
      </form>
    </div>`;

  document.getElementById("signupForm").addEventListener("submit", onSignupSubmit);
}

async function onSignupSubmit(e) {
  e.preventDefault();
  const msgEl = document.getElementById("signupMsg");
  const btn = document.getElementById("signupBtn");
  const email = document.getElementById("signupEmail").value.trim();
  if (!email) return;

  btn.disabled = true;
  btn.textContent = "Signing Up…";
  try {
    const res = await fetch("/api/lunch-sale/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (!res.ok) {
      showMsg(msgEl, "error", data.error || "Something went wrong — please try again.");
      btn.disabled = false;
      btn.textContent = "Get Notified";
      return;
    }
    showMsg(msgEl, "success", "You're on the list! We'll email you when a lunch sale opens.");
    btn.textContent = "You're Signed Up";
  } catch (err) {
    console.error(err);
    showMsg(msgEl, "error", "Network error — please try again.");
    btn.disabled = false;
    btn.textContent = "Get Notified";
  }
}

function renderOrderForm(area, event) {
  const remaining = event.slots_remaining ?? Math.max(0, event.slot_cap - (event.slots_used || 0));
  const low = remaining <= Math.max(1, Math.round(event.slot_cap * 0.2));
  const dropoffs = safeParseDropoffs(event.dropoff_options);
  const soldOut = remaining <= 0;
  const cutoffPassed = new Date(event.order_cutoff_at).getTime() < Date.now();
  const closed = soldOut || cutoffPassed;

  const thumb = event.image_url ? `<img src="${escapeHtml(event.image_url)}" alt="" class="lunch-thumb">` : "";
  const extendedBanner =
    event.cutoff_extended && !closed
      ? `<div class="cutoff-extended-banner">⏰ Order cutoff extended — place your order now!</div>`
      : "";

  area.innerHTML = `
    <div class="lunch-card" style="max-width:560px;margin:0 auto;">
      ${thumb}
      ${extendedBanner}
      <span class="slots-left${low ? " low" : ""}">${
    closed ? "Ordering closed" : `${remaining} lunch${remaining === 1 ? "" : "es"} left`
  }</span>
      ${!closed ? `<span class="live-badge">Live: Order Now</span>` : ""}
      <h3 style="margin-bottom:6px;">${escapeHtml(event.title)}</h3>
      <p style="margin-bottom:14px;">${escapeHtml(event.menu_description)}</p>
      <p style="margin-bottom:6px;font-size:0.9rem;"><strong>For:</strong> ${formatDate(event.sale_date)}</p>
      <p style="margin-bottom:6px;font-size:0.9rem;"><strong>Price:</strong> $${(event.price_cents / 100).toFixed(
        2
      )} per lunch</p>
      <p style="margin-bottom:20px;font-size:0.9rem;"><strong>Order by:</strong> ${formatDateTime(
        event.order_cutoff_at
      )}</p>

      ${
        closed
          ? `<p style="margin:0;">${
              soldOut ? "This lunch sale is sold out." : "Ordering has closed for this lunch sale."
            } Check back for the next one.</p>`
          : `<div id="orderStep">
        <form class="form-card" id="orderForm" style="text-align:left;padding:0;border:none;">
          <div class="field">
            <label for="dropoff_choice">Drop-off</label>
            <select id="dropoff_choice" name="dropoff_choice" required>
              <option value="">Select a drop-off time &amp; location</option>
              ${dropoffs
                .map((d) => {
                  const val = `${d.time} — ${d.location}`;
                  return `<option value="${escapeHtml(val)}">${escapeHtml(val)}</option>`;
                })
                .join("")}
            </select>
          </div>

          <div class="field">
            <label>Quantity</label>
            <div class="qty-row">
              <button type="button" id="qtyMinus">−</button>
              <input type="number" id="quantity" min="1" max="${orderMaxQty(event)}" value="1">
              <button type="button" id="qtyPlus">+</button>
            </div>
          </div>

          <div class="field-row">
            <div class="field">
              <label for="name">Full name</label>
              <input type="text" id="name" name="name" required>
            </div>
            <div class="field">
              <label for="email">Email</label>
              <input type="email" id="email" name="email" required>
            </div>
          </div>

          <div class="field">
            <label for="phone">Phone</label>
            <input type="tel" id="phone" name="phone">
          </div>

          <div class="order-summary" id="lunchOrderSummary" style="display:block;">
            <div class="total">Total due now<span id="lunchTotal">$${(event.price_cents / 100).toFixed(
              2
            )}</span></div>
          </div>

          <button type="submit" class="btn btn-primary" id="orderBtn" style="width:100%;justify-content:center;">Continue to Payment</button>
          <div class="form-msg" id="orderMsg"></div>
        </form>
      </div>
      <div id="paymentStep" style="display:none;">
        <div class="order-summary" id="lunchPaymentSummary" style="display:block;"></div>
        <div id="lunchStripeLoading" class="stripe-loading">Loading secure payment…</div>
        <div id="lunchExpressCheckoutElement"></div>
        <div class="stripe-divider" id="lunchStripeDivider" style="display:none;"><span>Or pay with card</span></div>
        <form id="lunchPaymentForm" style="display:none;">
          <div class="field" style="margin-bottom:12px;">
            <label for="lunchLinkAuthenticationElement">Email</label>
            <div id="lunchLinkAuthenticationElement"></div>
          </div>
          <div id="lunchPaymentElement" style="margin-bottom:20px;"></div>
          <button type="submit" class="btn btn-primary" id="lunchPayBtn" style="width:100%;justify-content:center;">Pay Now</button>
          <div class="form-msg" id="lunchPaymentMessage"></div>
        </form>
      </div>`
      }
    </div>`;

  if (!closed) {
    document.getElementById("qtyMinus").addEventListener("click", () => stepQty(-1, event));
    document.getElementById("qtyPlus").addEventListener("click", () => stepQty(1, event));
    document.getElementById("quantity").addEventListener("input", () => updateTotal(event));
    document.getElementById("orderForm").addEventListener("submit", (e) => onOrderSubmit(e, event));
  }
}

// The lower of the event's own per-order limit and however many lunches
// are actually still available — keeps a customer near the end of a sale
// from filling out the whole form only to get rejected at submit.
function orderMaxQty(event) {
  const remaining = event.slots_remaining ?? Math.max(0, event.slot_cap - (event.slots_used || 0));
  return Math.max(1, Math.min(event.max_qty_per_order || 10, remaining));
}

function stepQty(delta, event) {
  const input = document.getElementById("quantity");
  const max = orderMaxQty(event);
  let val = Number(input.value) || 1;
  val = Math.min(max, Math.max(1, val + delta));
  input.value = val;
  updateTotal(event);
}

function updateTotal(event) {
  const qty = Math.max(1, Number(document.getElementById("quantity").value) || 1);
  const total = (qty * event.price_cents) / 100;
  document.getElementById("lunchTotal").textContent = `$${total.toFixed(2)}`;
}

async function onOrderSubmit(e, event) {
  e.preventDefault();
  const msgEl = document.getElementById("orderMsg");
  const btn = document.getElementById("orderBtn");

  const payload = {
    name: document.getElementById("name").value.trim(),
    email: document.getElementById("email").value.trim(),
    phone: document.getElementById("phone").value.trim(),
    quantity: Math.max(1, Number(document.getElementById("quantity").value) || 1),
    dropoff_choice: document.getElementById("dropoff_choice").value,
  };

  if (!payload.dropoff_choice) {
    showMsg(msgEl, "error", "Please choose a drop-off time and location.");
    return;
  }

  btn.disabled = true;
  btn.textContent = "Starting Checkout…";

  try {
    const res = await fetch(`/api/lunch-sale/${event.id}/order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      showMsg(msgEl, "error", data.error || "Something went wrong — please try again.");
      btn.disabled = false;
      btn.textContent = "Continue to Payment";
      return;
    }

    currentOrderId = data.order_id;
    checkoutEmail = payload.email;

    document.getElementById("lunchPaymentSummary").innerHTML = `
      <div class="line">${escapeHtml(payload.name)} — ${escapeHtml(String(payload.quantity))} lunch(es)</div>
      <div class="total">Total due now<span>$${(data.amount / 100).toFixed(2)}</span></div>`;

    document.getElementById("orderStep").style.display = "none";
    document.getElementById("paymentStep").style.display = "block";

    await initStripe(data);
  } catch (err) {
    console.error(err);
    showMsg(msgEl, "error", "Network error — please try again.");
    btn.disabled = false;
    btn.textContent = "Continue to Payment";
  }
}

async function initStripe(data) {
  const loadingEl = document.getElementById("lunchStripeLoading");
  try {
    stripe = Stripe(data.publishable_key);
    elements = stripe.elements({ clientSecret: data.client_secret, appearance: BRAND_APPEARANCE });

    const expressCheckoutElement = elements.create("expressCheckout");
    expressCheckoutElement.mount("#lunchExpressCheckoutElement");
    expressCheckoutElement.on("ready", ({ availablePaymentMethods }) => {
      if (availablePaymentMethods) document.getElementById("lunchStripeDivider").style.display = "flex";
    });
    expressCheckoutElement.on("confirm", () => confirmLunchPayment());

    const linkAuthEl = elements.create("linkAuthentication", {
      defaultValues: { email: checkoutEmail },
    });
    linkAuthEl.mount("#lunchLinkAuthenticationElement");
    linkAuthEl.on("change", (e) => {
      checkoutEmail = e.value.email;
    });

    const paymentElement = elements.create("payment");
    paymentElement.mount("#lunchPaymentElement");

    loadingEl.style.display = "none";
    document.getElementById("lunchPaymentForm").style.display = "block";
    document.getElementById("lunchPaymentForm").addEventListener("submit", (e) => {
      e.preventDefault();
      confirmLunchPayment();
    });
  } catch (err) {
    console.error(err);
    loadingEl.textContent = "Could not start payment — please refresh and try again.";
  }
}

async function confirmLunchPayment() {
  const btn = document.getElementById("lunchPayBtn");
  const msgEl = document.getElementById("lunchPaymentMessage");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Processing…";
  }

  const { error, paymentIntent } = await stripe.confirmPayment({
    elements,
    confirmParams: {
      return_url: `${window.location.origin}/lunch-sale/?paid=1&order=${currentOrderId}`,
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
    window.location.href = `/lunch-sale/?paid=1&order=${currentOrderId}`;
  }
}

function safeParseDropoffs(raw) {
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function showMsg(el, type, text) {
  el.className = `form-msg show ${type}`;
  el.textContent = text;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

function formatDate(dateStr) {
  try {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  } catch {
    return dateStr;
  }
}

function formatDateTime(s) {
  try {
    const d = new Date(s);
    return d.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return s;
  }
}
