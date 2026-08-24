document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("contactForm");
  if (form) form.addEventListener("submit", onSubmit);
});

async function onSubmit(e) {
  e.preventDefault();
  const msgEl = document.getElementById("formMsg");
  const submitBtn = document.getElementById("submitBtn");

  const payload = {
    name: document.getElementById("name").value.trim(),
    email: document.getElementById("email").value.trim(),
    phone: document.getElementById("phone").value.trim(),
    guest_count: document.getElementById("guest_count").value
      ? Number(document.getElementById("guest_count").value)
      : null,
    event_date: document.getElementById("event_date").value || null,
    budget: document.getElementById("budget").value.trim(),
    location: document.getElementById("location").value.trim(),
    message: document.getElementById("message").value.trim(),
  };

  submitBtn.disabled = true;
  submitBtn.textContent = "Sending…";

  try {
    const res = await fetch("/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!res.ok) {
      showMsg(msgEl, "error", data.error || "Something went wrong — please try again.");
      submitBtn.disabled = false;
      submitBtn.textContent = "Send Message";
      return;
    }

    showMsg(msgEl, "success", "Message sent! We'll get back to you soon.");
    document.getElementById("contactForm").reset();
    submitBtn.textContent = "Message Sent";
  } catch (err) {
    console.error(err);
    showMsg(msgEl, "error", "Network error — please try again.");
    submitBtn.disabled = false;
    submitBtn.textContent = "Send Message";
  }
}

function showMsg(el, type, text) {
  el.className = `form-msg show ${type}`;
  el.textContent = text;
}
