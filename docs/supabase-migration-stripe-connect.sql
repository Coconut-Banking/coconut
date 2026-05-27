-- Stripe Connect: maps Coconut users to Stripe Express connected accounts
-- so Tap to Pay funds route directly to each receiver's bank account.

create table if not exists stripe_connected_accounts (
  id                  uuid primary key default gen_random_uuid(),
  clerk_user_id       text not null unique,
  stripe_account_id   text not null unique,
  onboarding_complete boolean not null default false,
  charges_enabled     boolean not null default false,
  payouts_enabled     boolean not null default false,
  last_auto_payout_at timestamptz,
  auto_payout_enabled boolean not null default false,
  auto_payout_threshold_usd smallint,
  created_at          timestamptz default now()
);

create index if not exists stripe_connect_user_idx on stripe_connected_accounts(clerk_user_id);
create index if not exists stripe_connect_acct_idx on stripe_connected_accounts(stripe_account_id);

alter table stripe_connected_accounts enable row level security;
