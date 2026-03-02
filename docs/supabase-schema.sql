-- ============================================================
-- Coconut — Supabase Schema
-- Run this entire file in the Supabase SQL Editor
-- ============================================================

-- 1. Enable pgvector
create extension if not exists vector;

-- 2. Plaid items (one row per connected bank per user)
create table if not exists plaid_items (
  id               uuid primary key default gen_random_uuid(),
  clerk_user_id    text not null unique,
  plaid_item_id    text not null,
  access_token     text not null,
  institution_name text,
  created_at       timestamptz default now()
);
create index if not exists plaid_items_user_idx on plaid_items(clerk_user_id);

-- 3. Accounts (from Plaid)
create table if not exists accounts (
  id               uuid primary key default gen_random_uuid(),
  clerk_user_id    text not null,
  plaid_account_id text not null unique,
  name             text,
  type             text,
  subtype          text,
  mask             text,
  created_at       timestamptz default now()
);
create index if not exists accounts_user_idx        on accounts(clerk_user_id);
create index if not exists accounts_plaid_acct_idx  on accounts(plaid_account_id);

-- 4. Transactions (core table — semantic search touches this only)
create table if not exists transactions (
  id                    uuid primary key default gen_random_uuid(),
  clerk_user_id         text not null,
  plaid_transaction_id  text not null unique,
  account_id            uuid references accounts(id) on delete set null,

  date                  date not null,
  amount                numeric(14,2) not null,  -- negative = expense, positive = income
  iso_currency_code     text default 'USD',

  raw_name              text,
  merchant_name         text,
  normalized_merchant   text,   -- lowercased, punctuation-stripped

  primary_category      text,   -- Plaid personal_finance_category.primary
  detailed_category     text,   -- Plaid personal_finance_category.detailed

  is_pending            boolean default false,

  embedding             vector(1536),  -- text-embedding-3-small

  created_at            timestamptz default now()
);

-- Required indexes for speed (critical for 20k+ transactions)
create index if not exists tx_user_date_idx       on transactions(clerk_user_id, date);
create index if not exists tx_user_merchant_idx   on transactions(clerk_user_id, normalized_merchant);
create index if not exists tx_user_category_idx   on transactions(clerk_user_id, primary_category);
create index if not exists tx_user_amount_idx     on transactions(clerk_user_id, amount);
create index if not exists tx_plaid_id_idx        on transactions(plaid_transaction_id);
create index if not exists tx_embedding_idx       on transactions using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- 5. Row Level Security
-- Service role key (used server-side) bypasses RLS automatically.
-- These policies prepare for future Clerk JWT integration.
alter table plaid_items  enable row level security;
alter table accounts     enable row level security;
alter table transactions enable row level security;

-- 6. Vector similarity search function (used by search-engine.ts)
create or replace function vector_search_transactions(
  p_user_id    text,
  p_embedding  vector(1536),
  p_date_start date default null,
  p_date_end   date default null,
  p_limit      int  default 20
)
returns table (
  id                   uuid,
  plaid_transaction_id text,
  merchant_name        text,
  raw_name             text,
  amount               numeric,
  date                 date,
  primary_category     text,
  detailed_category    text,
  iso_currency_code    text,
  is_pending           boolean
)
language sql
security definer
as $$
  select
    id, plaid_transaction_id, merchant_name, raw_name,
    amount, date, primary_category, detailed_category,
    iso_currency_code, is_pending
  from transactions
  where clerk_user_id = p_user_id
    and embedding is not null
    and (p_date_start is null or date >= p_date_start)
    and (p_date_end   is null or date <= p_date_end)
  order by embedding <=> p_embedding
  limit p_limit;
$$;
