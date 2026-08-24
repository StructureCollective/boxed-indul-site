// Shared menu-selection UI for /booking/ — renders the Boxed Lunch /
// Charcuterie / Custom Meal tabs + option cards from /data/content.json's
// `orderMenus`, tracks the customer's picks, and computes a running total.
// Shared by public/js/booking.js so pricing logic only needs editing in one
// place (content.json) and one renderer.
//
// The computed total here is a courtesy preview only — the server always
// recomputes it from content.json itself before charging anything.

const MenuSelector = (() => {
  let menus = null;
  let state = {
    menuType: "boxed_lunch",
    entree_id: null,
    board_id: null,
    box_id: null,
    enhancement_ids: [],
    personalization_ids: [],
  };
  let onChangeCb = null;
  let guestCountEl = null;

  async function init({ guestCountElId, tabsElId, panelsElId, summaryElId, onChange }) {
    onChangeCb = onChange;
    guestCountEl = document.getElementById(guestCountElId);
    const res = await fetch("/data/content.json");
    const content = await res.json();
    menus = content.orderMenus;

    document.querySelectorAll(`#${tabsElId} .tab-btn`).forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(`#${tabsElId} .tab-btn`).forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        state = {
          menuType: btn.dataset.menu,
          entree_id: null,
          board_id: null,
          box_id: null,
          enhancement_ids: [],
          personalization_ids: [],
        };
        render(panelsElId, summaryElId);
      });
    });

    guestCountEl?.addEventListener("input", () => renderSummary(summaryElId));

    render(panelsElId, summaryElId);
  }

  function optionCard({ groupName, id, name, price_cents, per_guest, quoted, description, type, checked }) {
    const priceLabel = quoted
      ? "Custom quote"
      : `$${(price_cents / 100).toFixed(2)}${per_guest ? " / guest" : ""}`;
    return `
      <label class="menu-option">
        <input type="${type}" name="${groupName}" value="${id}" ${checked ? "checked" : ""}>
        <div class="opt-top"><span class="opt-name">${name}</span><span class="opt-price">${priceLabel}</span></div>
        <div class="opt-desc">${description || ""}</div>
      </label>`;
  }

  function render(panelsElId, summaryElId) {
    const panels = document.getElementById(panelsElId);
    if (!menus) return;

    let html = "";
    if (state.menuType === "boxed_lunch") {
      const m = menus.boxed_lunch;
      html += `<p class="menu-note">${m.note || ""}</p>`;
      html += `<div class="field"><label>Choose your entrée</label><div class="menu-grid">`;
      html += m.entrees
        .map((e) => optionCard({ groupName: "entree", type: "radio", ...e, checked: state.entree_id === e.id }))
        .join("");
      html += `</div></div>`;
      html += `<div class="field"><label>Enhancements (optional)</label><div class="menu-grid">`;
      html += m.enhancements
        .map((e) => optionCard({ groupName: "enh", type: "checkbox", ...e, checked: state.enhancement_ids.includes(e.id) }))
        .join("");
      html += `</div></div>`;
    } else if (state.menuType === "charcuterie") {
      const m = menus.charcuterie;
      html += `<p class="menu-note">${m.note || ""}</p>`;
      html += `<div class="field"><label>Choose your board</label><div class="menu-grid">`;
      html += m.boards
        .map((b) => optionCard({ groupName: "board", type: "radio", ...b, checked: state.board_id === b.id }))
        .join("");
      html += `</div></div>`;
      html += `<div class="field"><label>Enhancements (optional)</label><div class="menu-grid">`;
      html += m.enhancements
        .map((e) => optionCard({ groupName: "enh", type: "checkbox", ...e, checked: state.enhancement_ids.includes(e.id) }))
        .join("");
      html += `</div></div>`;
    } else if (state.menuType === "custom_meal") {
      const m = menus.custom_meal;
      html += `<p class="menu-note">${m.note || ""}</p>`;
      html += `<div class="field"><label>Choose your box collection</label><div class="menu-grid">`;
      html += m.boxes
        .map((b) => optionCard({ groupName: "box", type: "radio", ...b, checked: state.box_id === b.id }))
        .join("");
      html += `</div></div>`;
      html += `<div class="field"><label>Personalization (optional — priced by quote)</label><div class="menu-grid">`;
      html += m.personalization
        .map((p) => optionCard({ groupName: "pers", type: "checkbox", ...p, checked: state.personalization_ids.includes(p.id) }))
        .join("");
      html += `</div></div>`;
    }

    panels.innerHTML = html;
    wireInputs(panelsElId, summaryElId);
    renderSummary(summaryElId);
  }

  function wireInputs(panelsElId, summaryElId) {
    const panels = document.getElementById(panelsElId);
    panels.querySelectorAll('input[name="entree"]').forEach((el) =>
      el.addEventListener("change", () => { state.entree_id = el.value; renderSummary(summaryElId); })
    );
    panels.querySelectorAll('input[name="board"]').forEach((el) =>
      el.addEventListener("change", () => { state.board_id = el.value; renderSummary(summaryElId); })
    );
    panels.querySelectorAll('input[name="box"]').forEach((el) =>
      el.addEventListener("change", () => { state.box_id = el.value; renderSummary(summaryElId); })
    );
    panels.querySelectorAll('input[name="enh"]').forEach((el) =>
      el.addEventListener("change", () => {
        state.enhancement_ids = [...panels.querySelectorAll('input[name="enh"]:checked')].map((x) => x.value);
        renderSummary(summaryElId);
      })
    );
    panels.querySelectorAll('input[name="pers"]').forEach((el) =>
      el.addEventListener("change", () => {
        state.personalization_ids = [...panels.querySelectorAll('input[name="pers"]:checked')].map((x) => x.value);
        renderSummary(summaryElId);
      })
    );
  }

  function findById(list, id) {
    return (list || []).find((x) => x.id === id) || null;
  }

  function computeTotal() {
    const guestCount = Math.max(1, Number(guestCountEl?.value) || 1);
    const m = menus[state.menuType];
    const lines = [];
    let total = 0;
    let hasQuoted = false;

    if (state.menuType === "boxed_lunch") {
      const entree = findById(m.entrees, state.entree_id);
      if (entree) {
        const lineTotal = entree.price_cents * guestCount;
        lines.push({ name: `${entree.name} x${guestCount}`, amount: lineTotal });
        total += lineTotal;
      }
      state.enhancement_ids.forEach((id) => {
        const e = findById(m.enhancements, id);
        if (!e) return;
        const qty = e.per_guest ? guestCount : 1;
        const lineTotal = e.price_cents * qty;
        lines.push({ name: `${e.name}${qty > 1 ? ` x${qty}` : ""}`, amount: lineTotal });
        total += lineTotal;
      });
    } else if (state.menuType === "charcuterie") {
      const board = findById(m.boards, state.board_id);
      if (board) {
        lines.push({ name: board.name, amount: board.price_cents });
        total += board.price_cents;
      }
      state.enhancement_ids.forEach((id) => {
        const e = findById(m.enhancements, id);
        if (!e) return;
        lines.push({ name: e.name, amount: e.price_cents });
        total += e.price_cents;
      });
    } else if (state.menuType === "custom_meal") {
      const box = findById(m.boxes, state.box_id);
      if (box) {
        const lineTotal = box.price_cents * guestCount;
        lines.push({ name: `${box.name} x${guestCount}`, amount: lineTotal });
        total += lineTotal;
      }
      state.personalization_ids.forEach((id) => {
        const p = findById(m.personalization, id);
        if (!p) return;
        hasQuoted = true;
        lines.push({ name: p.name, amount: null, quoted: true });
      });
    }

    return { lines, total, hasQuoted };
  }

  function renderSummary(summaryElId) {
    const el = document.getElementById(summaryElId);
    const { lines, total, hasQuoted } = computeTotal();
    if (!lines.length) {
      el.style.display = "none";
      onChangeCb?.({ total_cents: 0, hasQuoted: false, selection: getSelection() });
      return;
    }
    el.style.display = "block";
    const lineHtml = lines
      .map(
        (l) =>
          `<div class="line ${l.quoted ? "quoted" : ""}">${l.name}<span>${
            l.quoted ? "custom quote" : `$${(l.amount / 100).toFixed(2)}`
          }</span></div>`
      )
      .join("");
    el.innerHTML = `
      ${lineHtml}
      <div class="total">Estimated total<span>$${(total / 100).toFixed(2)}${hasQuoted ? "+" : ""}</span></div>
      <p class="deposit-note">Your deposit (a percentage of the total) will be confirmed once we review your order${
        hasQuoted ? " and price the custom items above" : ""
      }.</p>`;
    onChangeCb?.({ total_cents: total, hasQuoted, selection: getSelection() });
  }

  function getSelection() {
    return {
      menu_type: state.menuType,
      entree_id: state.entree_id,
      board_id: state.board_id,
      box_id: state.box_id,
      enhancement_ids: state.enhancement_ids,
      personalization_ids: state.personalization_ids,
    };
  }

  function isComplete() {
    if (state.menuType === "boxed_lunch") return !!state.entree_id;
    if (state.menuType === "charcuterie") return !!state.board_id;
    if (state.menuType === "custom_meal") return !!state.box_id;
    return false;
  }

  return { init, getSelection, isComplete, computeTotal };
})();
