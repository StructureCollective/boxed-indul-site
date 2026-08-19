// MockDB — a stand-in "database" for the sandbox preview.
//
// Everything lives in this browser's localStorage. Nothing is sent to a
// server, nothing syncs between devices or people, and it resets if you
// clear browsing data for this site. That's intentional: this preview is
// meant to demo the order/approval/deposit UX without needing any real
// Cloudflare, Stripe, or email setup.
//
// When it's time to go live, this whole file gets swapped out for real
// fetch() calls to a Worker + D1 database — see going-live-reference/ in
// the repo root for the already-built version of that.

const BOOKINGS_KEY = "bi_mock_bookings_v1";
const CONTACTS_KEY = "bi_mock_contacts_v1";

function readList(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.warn("MockDB: failed to read", key, err);
    return [];
  }
}

function writeList(key, list) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch (err) {
    console.warn("MockDB: failed to write", key, err);
  }
}

const MockDB = {
  newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  },

  nowIso() {
    return new Date().toISOString();
  },

  // ---- bookings ----
  getBookings() {
    return readList(BOOKINGS_KEY);
  },

  getBooking(id) {
    return readList(BOOKINGS_KEY).find((b) => b.id === id) || null;
  },

  addBooking(booking) {
    const list = readList(BOOKINGS_KEY);
    list.push(booking);
    writeList(BOOKINGS_KEY, list);
    return booking;
  },

  updateBookingStatus(id, status, extra = {}) {
    const list = readList(BOOKINGS_KEY);
    const idx = list.findIndex((b) => b.id === id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], status, ...extra, updated_at: MockDB.nowIso() };
    writeList(BOOKINGS_KEY, list);
    return list[idx];
  },

  unavailableDatesInMonth(monthStr) {
    // monthStr: 'YYYY-MM'
    return MockDB.getBookings()
      .filter((b) => ["pending_approval", "approved", "confirmed"].includes(b.status))
      .map((b) => b.event_date)
      .filter((d) => d && d.startsWith(monthStr));
  },

  // ---- contact messages ----
  getContacts() {
    return readList(CONTACTS_KEY);
  },

  addContact(msg) {
    const list = readList(CONTACTS_KEY);
    list.push(msg);
    writeList(CONTACTS_KEY, list);
    return msg;
  },

  // ---- demo utility ----
  resetAll() {
    localStorage.removeItem(BOOKINGS_KEY);
    localStorage.removeItem(CONTACTS_KEY);
  },
};
