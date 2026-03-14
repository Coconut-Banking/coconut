-- Allow multiple bank connections per user (multi-bank support)
-- Run in Supabase SQL Editor. Required for connecting multiple banks.
-- If not run: savePlaidToken falls back to single-bank (one row per user).
-- Previously: clerk_user_id was UNIQUE, so only one bank per user.
-- After: plaid_item_id is unique — one row per connected bank.

-- 1. Drop the unique constraint on clerk_user_id (allows multiple banks per user)
alter table plaid_items drop constraint if exists plaid_items_clerk_user_id_key;

-- 2. Ensure plaid_item_id is unique (one row per connected bank; required for upsert)
create unique index if not exists plaid_items_plaid_item_id_key on plaid_items(plaid_item_id);
