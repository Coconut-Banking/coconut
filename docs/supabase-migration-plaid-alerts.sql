-- Add update-mode alert flags to plaid_items.
-- Run in Supabase SQL Editor.

alter table plaid_items add column if not exists needs_reauth boolean default false;

alter table plaid_items add column if not exists new_accounts_available boolean default false;
