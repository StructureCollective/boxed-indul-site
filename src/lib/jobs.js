// Registry of the hidden "interest" pages for targeted lunch drop-off
// outreach — see /interest/?job=<slug> (public/interest/index.html +
// public/js/interest.js).
//
// To add a new target business/location: add one line to INTEREST_JOBS
// below and share the URL
//   https://boxedindulgence.com/interest/?job=<slug>
// No new files or other code changes needed. Keep slugs URL-safe
// (lowercase letters, digits, hyphens) — they're used as a query-string
// value and stored as-is in lunch_sale_signups.source.
export const INTEREST_JOBS = {
  usps: "USPS",
  toyota: "Toyota",
  "police-station": "Police Station",
};

// Source value for the public, un-targeted "Get Notified" form at
// /lunch-sale/ (shown there when no sale is currently live).
export const GENERAL_SOURCE = "general";

export function isKnownSource(source) {
  return (
    source === GENERAL_SOURCE ||
    Object.prototype.hasOwnProperty.call(INTEREST_JOBS, source)
  );
}

// Human-readable label for a signup's `source` column — used by the admin
// dashboard and the confirmation/lead emails. Falls back to the raw slug
// if a job was later renamed or removed from the registry above, so old
// rows never disappear or throw.
export function resolveJobLabel(source) {
  if (!source || source === GENERAL_SOURCE) return "General List";
  return INTEREST_JOBS[source] || source;
}
