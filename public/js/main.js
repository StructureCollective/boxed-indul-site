// Shared behavior for the marketing pages (home). Booking/contact/admin
// pages have their own small scripts (booking.js, contact.js, admin.js).

document.addEventListener("DOMContentLoaded", () => {
  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  const navToggle = document.getElementById("navToggle");
  const mainNav = document.getElementById("mainNav");
  if (navToggle && mainNav) {
    navToggle.addEventListener("click", () => mainNav.classList.toggle("open"));
  }

  const heroSection = document.getElementById("heroSection");
  if (heroSection) {
    heroSection.style.setProperty("--hero-img", "url('/img/hero-bg.jpg')");
  }

  if (document.getElementById("promoGrid")) {
    loadContent();
  }
  if (document.getElementById("lunchSaleContent")) {
    loadLunchSale();
  }
});

async function loadLunchSale() {
  const el = document.getElementById("lunchSaleContent");
  try {
    const res = await fetch("/api/lunch-sale/current");
    const data = await res.json();
    renderLunchSale(el, data.event);
  } catch (err) {
    console.error("Failed to load lunch sale", err);
    renderLunchSale(el, null);
  }
}

function renderLunchSale(el, event) {
  if (!event) {
    el.innerHTML = `
      <div class="lunch-none-card">
        <p style="margin:0 0 12px;font-weight:600;color:var(--black);">No upcoming sale at this time.</p>
        <p style="margin:0 0 20px;">Want to hear about the next one? Sign up to get notified when a new lunch sale drops.</p>
        <a href="/lunch-sale/" class="btn btn-outline">Get Notified</a>
      </div>`;
    return;
  }

  const remaining = event.slots_remaining ?? Math.max(0, event.slot_cap - (event.slots_used || 0));
  const low = remaining <= Math.max(1, Math.round(event.slot_cap * 0.2));
  const dropoffs = safeParseDropoffs(event.dropoff_options);
  const extendedBanner = event.cutoff_extended
    ? `<div class="cutoff-extended-banner">⏰ Order cutoff extended — place your order now!</div>`
    : "";

  el.innerHTML = `
    <div class="lunch-card">
      ${extendedBanner}
      <span class="slots-left${low ? " low" : ""}">${remaining} lunch${remaining === 1 ? "" : "es"} left</span>
      <span class="live-badge">Live: Order Now</span>
      <h3 style="margin-bottom:6px;">${escapeHtml(event.title)}</h3>
      <p style="margin-bottom:14px;">${escapeHtml(event.menu_description)}</p>
      <p style="margin-bottom:6px;font-size:0.9rem;"><strong>For:</strong> ${formatDate(event.sale_date)}</p>
      <p style="margin-bottom:6px;font-size:0.9rem;"><strong>Price:</strong> $${(event.price_cents / 100).toFixed(2)} per lunch</p>
      <p style="margin-bottom:6px;font-size:0.9rem;"><strong>Order by:</strong> ${formatDateTime(event.order_cutoff_at)}</p>
      ${
        dropoffs.length
          ? `<p style="margin-bottom:18px;font-size:0.9rem;"><strong>Drop-off:</strong> ${dropoffs
              .map((d) => escapeHtml(`${d.time} — ${d.location}`))
              .join(" · ")}</p>`
          : ""
      }
      <a href="/lunch-sale/" class="btn btn-primary">Order Now</a>
    </div>`;
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

async function loadContent() {
  try {
    const res = await fetch("/data/content.json");
    const data = await res.json();
    renderPromotions(data.promotions || []);
    renderMenus(data.menus || {});
    renderTestimonials(data.testimonials || []);
    wireTabs();
    wireTestiFilter(data.testimonials || []);
  } catch (err) {
    console.error("Failed to load content.json", err);
  }
}

function renderPromotions(promos) {
  const grid = document.getElementById("promoGrid");
  if (!grid) return;
  if (!promos.length) {
    grid.innerHTML = `<p style="text-align:center;color:var(--muted);">No active promotions right now — check back soon.</p>`;
    return;
  }
  grid.innerHTML = promos
    .map(
      (p) => `
    <div class="promo-card">
      <span class="tag">${escapeHtml(p.tag || "Special")}</span>
      <h3>${escapeHtml(p.title)}</h3>
      <p>${escapeHtml(p.description)}</p>
      ${p.expires ? `<div class="expires">Ends ${formatDate(p.expires)}</div>` : ""}
    </div>`
    )
    .join("");
}

function renderMenus(menus) {
  for (const key of Object.keys(menus)) {
    const panel = document.getElementById(`panel-${key}`);
    if (!panel) continue;
    panel.innerHTML = `<div class="menu-list">${menus[key]
      .map(
        (item) => `
      <div class="menu-item">
        <div class="row"><strong>${escapeHtml(item.name)}</strong><span class="price">${escapeHtml(
          item.price
        )}</span></div>
        <p>${escapeHtml(item.description)}</p>
      </div>`
      )
      .join("")}</div>`;
  }
}

function wireTabs() {
  const buttons = document.querySelectorAll(".tabs .tab-btn[data-tab]");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      document
        .querySelectorAll(".tab-panel")
        .forEach((p) => p.classList.remove("active"));
      document.getElementById(`panel-${btn.dataset.tab}`)?.classList.add("active");
    });
  });
}

function renderTestimonials(list) {
  const grid = document.getElementById("testiGrid");
  if (!grid) return;
  grid.dataset.all = JSON.stringify(list);
  grid.innerHTML = list.map(testiCard).join("");
}

function testiCard(t) {
  return `
    <div class="testi-card" data-type="${escapeHtml(t.type)}">
      <p class="quote">"${escapeHtml(t.quote)}"</p>
      <div class="who">${escapeHtml(t.name)} <span>— ${escapeHtml(t.context || "")}</span></div>
    </div>`;
}

function wireTestiFilter(list) {
  const buttons = document.querySelectorAll(".tabs .tab-btn[data-testi]");
  const grid = document.getElementById("testiGrid");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const filter = btn.dataset.testi;
      const filtered =
        filter === "all" ? list : list.filter((t) => t.type === filter);
      grid.innerHTML = filtered.length
        ? filtered.map(testiCard).join("")
        : `<p style="text-align:center;color:var(--muted);">No testimonials in this category yet.</p>`;
    });
  });
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

function formatDate(s) {
  try {
    const d = new Date(s + "T00:00:00");
    return d.toLocaleDateString(undefined, {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return s;
  }
}
