-- P2P annotations: user-provided counterparty names for P2P transactions
create table if not exists p2p_annotations (
  id                uuid primary key default gen_random_uuid(),
  clerk_user_id     text not null,
  transaction_id    uuid not null references transactions(id) on delete cascade,
  counterparty_name text not null,
  note              text,
  platform          text,
  created_at        timestamptz default now(),
  unique(transaction_id)
);
create index if not exists p2p_ann_user_idx on p2p_annotations(clerk_user_id);
alter table p2p_annotations enable row level security;
create policy p2p_ann_rls on p2p_annotations using (clerk_user_id = current_setting('app.user_id'));

-- Manual accounts: virtual wallets for Venmo/CashApp/PayPal balances
create table if not exists manual_accounts (
  id                uuid primary key default gen_random_uuid(),
  clerk_user_id     text not null,
  name              text not null,
  platform          text not null,
  balance           numeric(14,2) default 0,
  iso_currency_code text default 'USD',
  updated_at        timestamptz default now(),
  created_at        timestamptz default now(),
  unique(clerk_user_id, platform, name)
);
create index if not exists manual_acct_user_idx on manual_accounts(clerk_user_id);
alter table manual_accounts enable row level security;
create policy manual_acct_rls on manual_accounts using (clerk_user_id = current_setting('app.user_id'));

-- P2P transactions: imported from CSV or PayPal sync
create table if not exists p2p_transactions (
  id                    uuid primary key default gen_random_uuid(),
  clerk_user_id         text not null,
  platform              text not null,
  external_id           text,
  date                  date not null,
  amount                numeric(14,2) not null,
  counterparty_name     text not null,
  note                  text,
  status                text default 'completed',
  linked_transaction_id uuid references transactions(id) on delete set null,
  link_confidence       text,
  created_at            timestamptz default now(),
  unique(clerk_user_id, platform, external_id)
);
create index if not exists p2p_tx_user_date_idx on p2p_transactions(clerk_user_id, date);
create index if not exists p2p_tx_user_amount_idx on p2p_transactions(clerk_user_id, date, amount);
create index if not exists p2p_tx_linked_idx on p2p_transactions(linked_transaction_id);
alter table p2p_transactions enable row level security;
create policy p2p_tx_rls on p2p_transactions using (clerk_user_id = current_setting('app.user_id'));

-- PayPal OAuth connections
create table if not exists paypal_connections (
  id              uuid primary key default gen_random_uuid(),
  clerk_user_id   text not null unique,
  access_token    text not null,
  refresh_token   text,
  token_expiry    timestamptz,
  email           text,
  paypal_payer_id text,
  last_sync_at    timestamptz,
  sync_cursor     text,
  created_at      timestamptz default now()
);
alter table paypal_connections enable row level security;
create policy paypal_conn_rls on paypal_connections using (clerk_user_id = current_setting('app.user_id'));

-- P2P handles on group members (for deep-link payments)
alter table group_members add column if not exists venmo_username text;
alter table group_members add column if not exists cashapp_cashtag text;
alter table group_members add column if not exists paypal_username text;
