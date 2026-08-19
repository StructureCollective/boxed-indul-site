// Simulated deposit checkout — stands in for a real Stripe Checkout page.
// Marks the booking "confirmed" in MockDB and bounces back to /booking/.

let currentBooking = null;

document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("booking");
  currentBooking = id ? MockDB.getBooking(id) : null;

  const summary = document.getElementById("summaryText");
  const form = document.getElementById("checkoutForm");
  const notFound = document.getElementById("notFoundCard");

  if (!currentBooking || currentBooking.status !== "approved") {
    summary.textContent = "";
    notFound.style.display = "block";
    return;
  }

  const amount = ((currentBooking.deposit_amount_cents || 0) / 100).toFixed(2);
  summary.textContent = `${currentBooking.name}, pay your $${amount} deposit to lock in your order for ${formatDate(
    currentBooking.event_date
  )} (${currentBooking.guest_count} boxes).`;
  form.style.display = "block";
  form.addEventListener("submit", onPay);
});

function onPay(e) {
  e.preventDefault();
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
