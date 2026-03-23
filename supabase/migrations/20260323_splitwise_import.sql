-- Allow split_transactions without a linked bank transaction (for Splitwise imports & manual expenses)
alter table split_transactions alter column transaction_id drop not null;

-- Track import source on split_transactions
alter table split_transactions add column if not exists source text default 'manual';
alter table split_transactions add column if not exists external_id text;
alter table split_transactions add column if not exists description text;
alter table split_transactions add column if not exists amount numeric(14,2);
alter table split_transactions add column if not exists date date;

-- Track Splitwise source on groups
alter table groups add column if not exists source text default 'manual';
alter table groups add column if not exists external_id text;

-- Prevent re-importing the same Splitwise expense
create unique index if not exists split_transactions_source_ext_idx
  on split_transactions(source, external_id) where external_id is not null;

-- Prevent re-importing the same Splitwise group
create unique index if not exists groups_source_ext_idx
  on groups(source, external_id) where external_id is not null;

-- Store Splitwise OAuth tokens per user
create table if not exists splitwise_tokens (
  id          uuid primary key default gen_random_uuid(),
  clerk_user_id text not null unique,
  access_token text not null,
  created_at  timestamptz default now()
);
create index if not exists splitwise_tokens_user_idx on splitwise_tokens(clerk_user_id);
alter table splitwise_tokens enable row level security;
