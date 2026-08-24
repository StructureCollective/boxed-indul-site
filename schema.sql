-- Boxed Indulgence — D1 schema
-- Apply locally with:  npm run db:init
-- Apply to production with: npm run db:init:remote

-- ============================================================
-- Custom orders (Boxed Lunch / Charcuterie / Custom Meal quote
-- requests) — availability calendar -> admin approval -> deposit.
-- ============================================================
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  event_type TEXT NOT NULL,          -- corporate | wedding | private
  event_date TEXT NOT NULL,          -- YYYY-MM-DD, delivery/pickup date
  guest_count INTEGER NOT NULL,      -- number of boxed meals
  location TEXT,
  budget TEXT,
  notes TEXT,

  -- Itemized order, built from the Boxed Lunch / Charcuterie / Custom Meal
  -- menu templates. menu_type picks which template was used; order_items is
  -- a JSON array of {menu, item, qty, unit_price_cents, line_total_cents}.
  -- order_total_cents is the sum used to compute the deposit.
  menu_type TEXT,                    -- boxed_lunch | charcuterie | custom_meal
  order_items TEXT,                  -- JSON array, see above
  order_total_cents INTEGER,

  status TEXT NOT NULL DEFAULT 'pending_approval',
    -- pending_approval | approved | rejected | confirmed (deposit paid) | expired
  deposit_percent INTEGER,                  -- e.g. 25 = 25% of order_total_cents
  deposit_amount_cents INTEGER,
  deposit_link_expires_at TEXT,             -- ISO timestamp; app-enforced (Stripe caps at 24h)
  stripe_checkout_session_id TEXT,
  stripe_payment_status TEXT DEFAULT 'unpaid',
  google_calendar_event_id TEXT,            -- set once pushed to the connected calendar
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bookings_event_date ON bookings(event_date);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);

-- Dates the client manually blocks off (holidays, days off, etc.), and dates
-- blocked because they came back busy from the synced Google Calendar.
CREATE TABLE IF NOT EXISTS blocked_dates (
  date TEXT PRIMARY KEY,             -- YYYY-MM-DD
  reason TEXT,
  source TEXT NOT NULL DEFAULT 'manual'  -- manual | google_calendar
);

CREATE TABLE IF NOT EXISTS contact_messages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  guest_count INTEGER,               -- number of boxed meals
  event_date TEXT,
  location TEXT,
  budget TEXT,
  message TEXT,
  created_at TEXT NOT NULL
);

-- ============================================================
-- Lunch-sale events — periodic flash sales posted from the admin
-- side to the homepage: fixed menu, fixed cost, limited order
-- slots, a cutoff time, full payment up front.
-- ============================================================
CREATE TABLE IF NOT EXISTS lunch_sale_events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,                       -- e.g. "Friday Lunch Drop — Oct 3"
  menu_description TEXT NOT NULL,            -- what's in the lunch this round
  price_cents INTEGER NOT NULL,              -- price per lunch
  dropoff_options TEXT NOT NULL,             -- JSON array of {time, location}
  sale_date TEXT NOT NULL,                   -- YYYY-MM-DD the lunches are for
  order_cutoff_at TEXT NOT NULL,             -- ISO timestamp; last moment to order
  slot_cap INTEGER NOT NULL,                 -- max number of ORDERS (not lunches — qty/order can vary)
  max_qty_per_order INTEGER NOT NULL DEFAULT 10,
  status TEXT NOT NULL DEFAULT 'draft',      -- draft | live | closed | canceled
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lunch_events_status ON lunch_sale_events(status);

CREATE TABLE IF NOT EXISTS lunch_sale_orders (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES lunch_sale_events(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  quantity INTEGER NOT NULL,                 -- lunches in this one order/slot
  dropoff_choice TEXT NOT NULL,              -- the {time, location} the customer picked, as text
  total_cents INTEGER NOT NULL,              -- quantity * price_cents at time of order
  status TEXT NOT NULL DEFAULT 'pending_payment',
    -- pending_payment | paid | canceled | expired
  stripe_checkout_session_id TEXT,
  stripe_payment_status TEXT DEFAULT 'unpaid',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lunch_orders_event ON lunch_sale_orders(event_id);
CREATE INDEX IF NOT EXISTS idx_lunch_orders_status ON lunch_sale_orders(status);

-- "Sign up" list for when no lunch sale is currently live — captured from
-- the /lunch-sale/notify/ page and notified by the admin when a new event
-- goes live (manual send for now; a real broadcast tool can replace this later).
CREATE TABLE IF NOT EXISTS lunch_sale_signups (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

-- ============================================================
-- Google Calendar two-way sync — single-row table holding the
-- admin's connected account's OAuth refresh token.
-- ============================================================
CREATE TABLE IF NOT EXISTS google_calendar_connection (
  id TEXT PRIMARY KEY DEFAULT 'default',
  connected_email TEXT,
  refresh_token TEXT,
  calendar_id TEXT DEFAULT 'primary',
  last_synced_at TEXT,
  updated_at TEXT NOT NULL
);
