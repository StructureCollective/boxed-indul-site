// Contact form — sandbox version. Stores the message in MockDB
// (localStorage) instead of emailing it anywhere.

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("contactForm");
  if (form) form.addEventListener("submit", onSubmit);
});

function onSubmit(e) {
  e.preventDefault();
  const msgEl = document.getElementById("formMsg");
  const submitBtn = document.getElementById("submitBtn");

  const name = document.getElementById("name").value.trim();
  const email = document.getElementById("email").value.trim();
  const message = document.getElementById("message").value.trim();

  if (!name || !email || !message) {
    showMsg(msgEl, "error", "Please fill in your name, email, and message.");
    return;
  }

  const payload = {
    id: MockDB.newId(),
    name,
    email,
    phone: document.getElementById("phone").value.trim(),
    guest_count: document.getElementById("guest_count").value
      ? Number(document.getElementById("guest_count").value)
      : null,
    event_date: document.getElementById("event_date").value || null,
    budget: document.getElementById("budget").value.trim(),
    location: document.getElementById("location").value.trim(),
    message,
    created_at: MockDB.nowIso(),
  };

  submitBtn.disabled = true;
  submitBtn.textContent = "Sending…";

  setTimeout(() => {
    MockDB.addContact(payload);
    showMsg(msgEl, "success", "Message sent! (In the live site this emails the business owner directly.)");
    document.getElementById("contactForm").reset();
    submitBtn.textContent = "Message Sent";
  }, 400);
}

function showMsg(el, type, text) {
  el.className = `form-msg show ${type}`;
  el.textContent = text;
}
