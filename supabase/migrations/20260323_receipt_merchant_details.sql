-- Rich merchant-specific details extracted from email receipts.
-- Stored as JSONB so each merchant type can have its own shape.
alter table email_receipts add column if not exists merchant_details jsonb;

-- Merchant type tag for routing to specialized parsers.
-- e.g. 'rideshare', 'food_delivery', 'ecommerce', 'saas', 'retail'
alter table email_receipts add column if not exists merchant_type text;
