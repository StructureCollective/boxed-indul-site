// Real deposit checkout bridge page. This page itself stays valid for the
// full DEPOSIT_LINK_EXPIRY_HOURS window (see README) — the actual Stripe
// Checkout Session is only created the moment the customer clicks "Pay",
// since Stripe sessions themselves cap out at 24h.

let currentBooking = null;

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
      "Payment was canceled — no charge was made. Click below whenever you're ready.";
  }

  payCard.style.display = "block";
  document.getElementById("payBtn").addEventListener("click", onPay);
});

async function onPay() {
  const btn = document.getElementById("payBtn");
  btn.disabled = true;
  btn.textContent = "Redirecting to secure payment…";

  try {
    const res = await fetch(`/api/booking/${currentBooking.id}/checkout-session`, {
      method: "POST",
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || "Something went wrong — please try again.");
      btn.disabled = false;
      btn.textContent = "Pay Deposit Securely";
      return;
    }
    window.location.href = data.checkout_url;
  } catch (err) {
    console.error(err);
    alert("Network error — please try again.");
    btn.disabled = false;
    btn.textContent = "Pay Deposit Securely";
  }
}

function formatDate(dateStr) {
  try {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  } catch {
    return dateStr;
  }
}
