-- Add institution_id for duplicate Item detection.
-- Run in Supabase SQL Editor. Optional — duplicate check works without it for new Items.

alter table plaid_items add column if not exists institution_id text;

create index if not exists plaid_items_institution_idx on plaid_items(clerk_user_id, institution_id);
