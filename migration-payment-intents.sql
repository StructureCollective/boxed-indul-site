ALTER TABLE bookings ADD COLUMN stripe_payment_intent_id TEXT;
ALTER TABLE lunch_sale_orders ADD COLUMN stripe_payment_intent_id TEXT;
