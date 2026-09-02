export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      ...extraHeaders,
    },
  });
}

export function badRequest(message) {
  return json({ error: message }, 400);
}

export function newId() {
  return crypto.randomUUID();
}

export function nowIso() {
  return new Date().toISOString();
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function isValidDateString(s) {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime());
}

export function isFutureDate(s) {
  const d = new Date(s + "T00:00:00Z");
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return d.getTime() >= today.getTime();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isValidEmail(s) {
  return typeof s === "string" && EMAIL_RE.test(s);
}

const PHONE_RE = /^[0-9+()\-.\s]{7,20}$/;
export function isValidPhone(s) {
  if (typeof s !== "string") return false;
  const trimmed = s.trim();
  return PHONE_RE.test(trimmed) && trimmed.replace(/\D/g, "").length >= 7;
}

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}
