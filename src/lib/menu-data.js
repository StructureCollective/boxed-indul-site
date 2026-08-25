// Loads admin-editable menu/occasion data from the `site_settings` D1 table
// (key: order_menus, occasions) and uses it as the single source of truth
// for pricing and occasion validation. This means editing the Menus tab in
// /admin/ is enough to change prices and occasions everywhere; the server
// never trusts a price sent by the browser.
//
// This used to read public/data/content.json via the ASSETS binding, but
// that's a deployed static file — read-only at runtime, so it couldn't
// support admin edits without a redeploy. See migration-site-settings.sql /
// schema.sql's site_settings table for how these rows get seeded.

import { getSetting, setSetting } from "./db.js";

let cachedMenus = null;
let cachedMenusAt = 0;
let cachedOccasions = null;
let cachedOccasionsAt = 0;
const CACHE_MS = 60_000; // avoid re-reading D1 on every request

export async function loadOrderMenus(env) {
  const now = Date.now();
  if (cachedMenus && now - cachedMenusAt < CACHE_MS) return cachedMenus;

  const menus = await getSetting(env, "order_menus");
  cachedMenus = menus || {};
  cachedMenusAt = now;
  return cachedMenus;
}

export async function saveOrderMenus(env, menus) {
  await setSetting(env, "order_menus", menus);
  cachedMenus = menus;
  cachedMenusAt = Date.now();
}

export async function loadOccasions(env) {
  const now = Date.now();
  if (cachedOccasions && now - cachedOccasionsAt < CACHE_MS) return cachedOccasions;

  const occasions = await getSetting(env, "occasions");
  cachedOccasions = occasions || [];
  cachedOccasionsAt = now;
  return cachedOccasions;
}

export async function saveOccasions(env, occasions) {
  await setSetting(env, "occasions", occasions);
  cachedOccasions = occasions;
  cachedOccasionsAt = Date.now();
}

// Clears both in-memory caches immediately after an admin save, so the very
// next request (even inside the same 60s window) sees the new data instead
// of waiting out the cache.
export function invalidateMenuCache() {
  cachedMenus = null;
  cachedMenusAt = 0;
  cachedOccasions = null;
  cachedOccasionsAt = 0;
}

function findById(list, id) {
  return (list || []).find((x) => x.id === id) || null;
}

// Prices and validates a submitted custom order against orderMenus.
// selection shape (from the client):
// {
//   menu_type: "boxed_lunch" | "charcuterie" | "custom_meal",
//   guest_count: number,
//   entree_id / board_id / box_id: string,
//   enhancement_ids: string[] (boxed_lunch/charcuterie),
//   personalization_ids: string[] (custom_meal, quoted — priced by admin later)
// }
//
// Returns { order_items, order_total_cents, has_quoted_items }.
export async function priceOrder(env, selection) {
  const menus = await loadOrderMenus(env);
  const guestCount = Number(selection.guest_count) || 0;
  const items = [];
  let total = 0;
  let hasQuoted = false;

  if (selection.menu_type === "boxed_lunch") {
    const menu = menus.boxed_lunch;
    const entree = findById(menu?.entrees, selection.entree_id);
    if (!entree) throw new Error("Invalid entree selection");
    addLineItem(items, "boxed_lunch", entree, guestCount);
    total += entree.price_cents * guestCount;

    for (const id of selection.enhancement_ids || []) {
      const enh = findById(menu?.enhancements, id);
      if (!enh) continue;
      const qty = enh.per_guest ? guestCount : 1;
      addLineItem(items, "boxed_lunch", enh, qty);
      total += enh.price_cents * qty;
    }
  } else if (selection.menu_type === "charcuterie") {
    const menu = menus.charcuterie;
    const board = findById(menu?.boards, selection.board_id);
    if (!board) throw new Error("Invalid board selection");
    addLineItem(items, "charcuterie", board, 1);
    total += board.price_cents;

    for (const id of selection.enhancement_ids || []) {
      const enh = findById(menu?.enhancements, id);
      if (!enh) continue;
      addLineItem(items, "charcuterie", enh, 1);
      total += enh.price_cents;
    }
  } else if (selection.menu_type === "custom_meal") {
    const menu = menus.custom_meal;
    const box = findById(menu?.boxes, selection.box_id);
    if (!box) throw new Error("Invalid box selection");
    addLineItem(items, "custom_meal", box, guestCount);
    total += box.price_cents * guestCount;

    for (const id of selection.personalization_ids || []) {
      const p = findById(menu?.personalization, id);
      if (!p) continue;
      hasQuoted = true;
      items.push({
        menu: "custom_meal",
        item_id: p.id,
        item_name: p.name,
        unit_price_cents: null,
        quantity: 1,
        line_total_cents: null,
        quoted: true,
      });
    }
  } else {
    throw new Error("Invalid menu_type");
  }

  return { order_items: items, order_total_cents: total, has_quoted_items: hasQuoted };
}

function addLineItem(items, menu, def, qty) {
  items.push({
    menu,
    item_id: def.id,
    item_name: def.name,
    unit_price_cents: def.price_cents,
    quantity: qty,
    line_total_cents: def.price_cents * qty,
  });
}
