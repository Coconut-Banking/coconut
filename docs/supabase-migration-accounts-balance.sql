-- Add balance and currency to accounts for display
-- Run in Supabase SQL Editor before deploying the accounts/transactions UI changes
alter table accounts add column if not exists balance_current numeric(14,2);
alter table accounts add column if not exists balance_available numeric(14,2);
alter table accounts add column if not exists iso_currency_code text default 'USD';
