// Lunch Sale order/signup page. Shows the live lunch_sale_events entry with
// a qty + drop-off order form (full payment at Stripe Checkout), or a
// "no upcoming sale" placeholder with a notify-me signup form.

let currentEvent = null;

document.addEventListener("DOMContentLoaded", loadEvent);

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

  area.innerHTML = `
    <div class="lunch-card" style="max-width:560px;margin:0 auto;">
      <span class="slots-left${low ? " low" : ""}">${
    closed ? "Ordering closed" : `${remaining} order${remaining === 1 ? "" : "s"} left`
  }</span>
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
          : `<form class="form-card" id="orderForm" style="text-align:left;padding:0;border:none;">
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
            <input type="number" id="quantity" min="1" max="${event.max_qty_per_order || 10}" value="1">
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
          <div class="total">Total due now<span id="lunchTotal">$${(event.price_cents / 100).toFixed(2)}</span></div>
        </div>

        <button type="submit" class="btn btn-primary" id="orderBtn" style="width:100%;justify-content:center;">Order Now</button>
        <p class="form-note">Full payment is collected securely by Stripe on the next step.</p>
        <div class="form-msg" id="orderMsg"></div>
      </form>`
      }
    </div>`;

  if (!closed) {
    document.getElementById("qtyMinus").addEventListener("click", () => stepQty(-1, event));
    document.getElementById("qtyPlus").addEventListener("click", () => stepQty(1, event));
    document.getElementById("quantity").addEventListener("input", () => updateTotal(event));
    document.getElementById("orderForm").addEventListener("submit", (e) => onOrderSubmit(e, event));
  }
}

function stepQty(delta, event) {
  const input = document.getElementById("quantity");
  const max = event.max_qty_per_order || 10;
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
  btn.textContent = "Redirecting to secure payment…";

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
      btn.textContent = "Order Now";
      return;
    }
    window.location.href = data.checkout_url;
  } catch (err) {
    console.error(err);
    showMsg(msgEl, "error", "Network error — please try again.");
    btn.disabled = false;
    btn.textContent = "Order Now";
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
