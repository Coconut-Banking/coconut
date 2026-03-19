alter table email_receipts add column if not exists subtotal numeric(14,2);
alter table email_receipts add column if not exists tax numeric(14,2);
alter table email_receipts add column if not exists order_number text;
alter table email_receipts add column if not exists match_source text default 'auto';
