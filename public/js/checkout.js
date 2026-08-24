// Simulated deposit checkout — stands in for a real Stripe Checkout page.
// Marks the booking "confirmed" in MockDB and bounces back to /booking/.

let currentBooking = null;

document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("booking");
  currentBooking = id ? MockDB.getBooking(id) : null;

  const summary = document.getElementById("summaryText");
  const payCard = document.getElementById("payCard");
  const notFound = document.getElementById("notFoundCard");

  if (!currentBooking || currentBooking.status !== "approved") {
    summary.textContent = "";
    notFound.style.display = "block";
    return;
  }

  summary.textContent = `${currentBooking.name}, review your order below and pay your deposit to lock in ${formatDate(
    currentBooking.event_date
  )}.`;

  document.getElementById("orderSummary").innerHTML = `
    <div class="line">Order total<span>$${((currentBooking.order_total_cents || 0) / 100).toFixed(2)}</span></div>
    <div class="total">Deposit due now (${currentBooking.deposit_percent || 50}%)<span>$${(
      (currentBooking.deposit_amount_cents || 0) / 100
    ).toFixed(2)}</span></div>`;

  payCard.style.display = "block";
  document.getElementById("payBtn").addEventListener("click", onPay);
});

function onPay() {
  const btn = document.getElementById("payBtn");
  btn.disabled = true;
  btn.textContent = "Processing…";

  setTimeout(() => {
    MockDB.updateBookingStatus(currentBooking.id, "confirmed", { deposit_paid: true });
    window.location.href = `/booking/?paid=1&booking=${currentBooking.id}`;
  }, 700);
}

function formatDate(dateStr) {
  try {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  } catch {
    return dateStr;
  }
}
