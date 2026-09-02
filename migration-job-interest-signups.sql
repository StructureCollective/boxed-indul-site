ALTER TABLE lunch_sale_signups ADD COLUMN source TEXT NOT NULL DEFAULT 'general';
ALTER TABLE lunch_sale_signups ADD COLUMN contact_name TEXT;
ALTER TABLE lunch_sale_signups ADD COLUMN phone TEXT;
