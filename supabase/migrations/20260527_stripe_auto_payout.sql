-- Per-user automatic bank transfers (opt-in; off by default).
alter table stripe_connected_accounts
  add column if not exists last_auto_payout_at timestamptz;

alter table stripe_connected_accounts
  add column if not exists auto_payout_enabled boolean not null default false;

alter table stripe_connected_accounts
  add column if not exists auto_payout_threshold_usd smallint;

-- Only allow fixed thresholds when enabled (enforced in API).
comment on column stripe_connected_accounts.auto_payout_threshold_usd is
  'When auto_payout_enabled: must be 25, 50, or 100 (USD).';
