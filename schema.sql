-- Boxed Indulgence — D1 schema
-- Apply locally with:  npm run db:init
-- Apply to production with: npm run db:init:remote

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  event_type TEXT NOT NULL,          -- corporate | wedding | private
  event_date TEXT NOT NULL,          -- YYYY-MM-DD, delivery/pickup date
  guest_count INTEGER NOT NULL,      -- number of gift boxes
  location TEXT,
  budget TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending_approval',
    -- pending_approval | approved | rejected | confirmed (deposit paid)
  deposit_amount_cents INTEGER,
  stripe_checkout_session_id TEXT,
  stripe_payment_status TEXT DEFAULT 'unpaid',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bookings_event_date ON bookings(event_date);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);

-- Dates the client manually blocks off (holidays, days off, etc.)
CREATE TABLE IF NOT EXISTS blocked_dates (
  date TEXT PRIMARY KEY,             -- YYYY-MM-DD
  reason TEXT
);

CREATE TABLE IF NOT EXISTS contact_messages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  guest_count INTEGER,               -- number of gift boxes
  event_date TEXT,
  location TEXT,
  budget TEXT,
  message TEXT,
  created_at TEXT NOT NULL
);
