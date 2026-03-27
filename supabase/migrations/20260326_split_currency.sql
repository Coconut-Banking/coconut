-- Per-currency splits: never sum CAD + USD as one number (Splitwise parity).
alter table split_transactions add column if not exists iso_currency_code text;
alter table settlements add column if not exists iso_currency_code text default 'USD';

comment on column split_transactions.iso_currency_code is 'ISO 4217 code for expense amount and shares (e.g. CAD, USD).';
comment on column settlements.iso_currency_code is 'Currency this settlement applies to; balances are computed per currency.';
