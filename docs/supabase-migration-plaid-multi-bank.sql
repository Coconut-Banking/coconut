-- Allow multiple bank connections per user (multi-bank support)
-- Run in Supabase SQL Editor before deploying the multi-bank fix.
-- Previously: clerk_user_id was UNIQUE, so only one bank per user.
-- Now: one row per Plaid Item (per bank), plaid_item_id is globally unique.

-- 1. Drop the unique constraint on clerk_user_id
alter table plaid_items drop constraint if exists plaid_items_clerk_user_id_key;

-- 2. Ensure plaid_item_id is unique (one row per connected bank)
create unique index if not exists plaid_items_plaid_item_id_key on plaid_items(plaid_item_id);
