-- Run in Supabase SQL editor if not using migration runner.
-- See supabase/migrations/20260326_split_currency.sql

alter table split_transactions add column if not exists iso_currency_code text;
alter table settlements add column if not exists iso_currency_code text default 'USD';
