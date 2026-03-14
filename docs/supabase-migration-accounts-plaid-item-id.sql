-- Link accounts to Plaid Items so we can show institution name (Chase, Wells Fargo, etc.)
-- Run in Supabase SQL Editor.

alter table accounts add column if not exists plaid_item_id text;
create index if not exists accounts_plaid_item_idx on accounts(plaid_item_id);
