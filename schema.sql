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
  stripe_checkout_session_id TEXT,          -- unused (legacy hosted-Checkout flow)
  stripe_payment_intent_id TEXT,            -- embedded Payment/Express Checkout Element flow
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
  image_url TEXT,                            -- optional photo shown on the public order page
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
  stripe_checkout_session_id TEXT,          -- unused (legacy hosted-Checkout flow)
  stripe_payment_intent_id TEXT,            -- embedded Payment/Express Checkout Element flow
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

-- ============================================================
-- Site settings — key/value JSON store for admin-editable data
-- that used to live only in the static content.json file: the
-- order-menu pricing catalog (Boxed Lunch / Charcuterie / Custom
-- Meal) and the list of booking "Occasion" options. Seeded here
-- with the same defaults content.json used to ship with.
-- ============================================================
CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,               -- JSON, shape depends on key
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO site_settings (key, value, updated_at) VALUES ('order_menus', '{"boxed_lunch":{"label":"Boxed Lunch","note":"Each boxed lunch includes one entrée, one side, and one dessert unless otherwise noted.","entrees":[{"id":"signature_sandwich","name":"Signature Sandwich Box","price_cents":2400,"per_guest":true,"description":"Sandwich, bread, garnish, and dietary notes available."},{"id":"gourmet_wrap","name":"Gourmet Wrap Box","price_cents":2400,"per_guest":true,"description":"Wrap selection, filling, and dietary notes available."},{"id":"seasonal_salad","name":"Seasonal Salad Box","price_cents":2200,"per_guest":true,"description":"Greens, protein, toppings, and dressing."},{"id":"premium_entree","name":"Premium Entrée Box","price_cents":2800,"per_guest":true,"description":"Chef-selected entrée and accompaniments."}],"enhancements":[{"id":"classic_side","name":"Classic Side","price_cents":400,"per_guest":true,"description":"Chips, pasta salad, fruit, or seasonal option."},{"id":"beverage","name":"Beverage","price_cents":350,"per_guest":true,"description":"Bottled water, tea, juice, or specialty beverage."},{"id":"dessert_upgrade","name":"Dessert Upgrade","price_cents":450,"per_guest":true,"description":"Cookie, brownie, mini pastry, or seasonal sweet."}]},"charcuterie":{"label":"Charcuterie Board","note":"Boards arrive arranged and ready to enjoy. Serving pieces and on-site setup are not included.","boards":[{"id":"petite_board","name":"The Petite Board","price_cents":6500,"per_guest":false,"description":"Designed for 6–10 guests; cheeses, cured meats, fruit, crackers, accompaniments."},{"id":"signature_board","name":"The Signature Board","price_cents":9500,"per_guest":false,"description":"Designed for 12–18 guests; expanded premium assortment."},{"id":"grand_board","name":"The Grand Board","price_cents":15000,"per_guest":false,"description":"Designed for 20–30 guests; luxury assortment and seasonal accents."},{"id":"vegetarian_board","name":"Vegetarian Grazing Board","price_cents":8500,"per_guest":false,"description":"Designed for 10–15 guests; cheeses, produce, dips, nuts, breads."}],"enhancements":[{"id":"dessert_pairing","name":"Dessert Pairing","price_cents":3500,"per_guest":false,"description":"Chocolate, pastries, fruit, or sweet bites."},{"id":"beverage_pairing","name":"Beverage Pairing","price_cents":3000,"per_guest":false,"description":"Nonalcoholic beverage selection."},{"id":"personalized_note","name":"Personalized Note / Branding","price_cents":1500,"per_guest":false,"description":"Card, label, ribbon, or branded detail."}]},"custom_meal":{"label":"Custom Boxed Meal","note":"Final selections and pricing will be confirmed through a personalized quote — the total below is a starting estimate.","boxes":[{"id":"breakfast_box","name":"Breakfast Box","price_cents":1800,"per_guest":true,"description":"Pastry, fruit, protein, and beverage options."},{"id":"brunch_box","name":"Brunch Box","price_cents":2200,"per_guest":true,"description":"Savory item, sweet item, fruit, and accompaniment."},{"id":"grazing_box","name":"Grazing Box","price_cents":2600,"per_guest":true,"description":"Cheese, charcuterie, fruit, crackers, and accompaniments."},{"id":"sweet_indulgence_box","name":"Sweet Indulgence Box","price_cents":1600,"per_guest":true,"description":"Dessert assortment and presentation details."}],"personalization":[{"id":"custom_menu_dev","name":"Custom Menu Development","quoted":true,"description":"Describe theme, preferences, and dietary needs."},{"id":"branded_packaging","name":"Branded Packaging","quoted":true,"description":"Logo label, card, ribbon, or color treatment."},{"id":"dietary_accommodation","name":"Dietary Accommodation","quoted":true,"description":"Vegetarian, vegan, gluten-conscious, or other."}]}}', '2026-08-25T00:00:00.000Z');
INSERT OR IGNORE INTO site_settings (key, value, updated_at) VALUES ('occasions', '[{"value":"corporate","label":"Corporate Catering"},{"value":"wedding","label":"Wedding / Event Catering"},{"value":"private","label":"Personal / Celebration"}]', '2026-08-25T00:00:00.000Z');
