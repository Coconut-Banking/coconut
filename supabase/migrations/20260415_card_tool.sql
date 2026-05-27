-- Credit card recommendation tool tables

create table if not exists credit_cards (
  id text primary key, -- slug like "chase-sapphire-preferred"
  name text not null,
  issuer text not null,
  network text not null, -- visa, mastercard, amex, discover
  annual_fee integer not null default 0, -- in dollars
  rewards_program text not null, -- chase_ur, amex_mr, capital_one_miles, cash_back, miles, points
  rewards_value_cpp numeric not null default 1.0, -- cents per point for normalization
  earn_rates jsonb not null default '{}', -- { dining: 3, travel: 2, groceries: 1, gas: 1, streaming: 1, transit: 1, base: 1 }
  sign_up_bonus_value integer not null default 0, -- approximate cash value in dollars
  sign_up_bonus_spend integer not null default 0, -- spend required
  sign_up_bonus_days integer not null default 90,
  foreign_transaction_fee boolean not null default false,
  credit_score_minimum integer not null default 670, -- 580/670/700/720/750
  is_business boolean not null default false,
  key_perks text[] not null default '{}', -- up to 4 bullet points
  pairs_well_with text[] not null default '{}', -- other card IDs
  image_url text,
  apply_url text,
  active boolean not null default true,
  created_at timestamptz default now()
);

create table if not exists card_tool_sessions (
  id uuid primary key default gen_random_uuid(),
  plaid_access_token text, -- encrypted, nullable (null if existing Coconut user)
  plaid_item_id text,
  clerk_user_id text, -- nullable, filled if existing Coconut user or after signup
  spend_summary jsonb, -- { dining: 450, travel: 200, groceries: 380, gas: 120, streaming: 45, transit: 30, other: 800, total: 2025, months_analyzed: 3 }
  quiz_answers jsonb, -- { max_annual_fee: 95, networks: ["visa","mastercard"], existing_cards: ["chase-sapphire-preferred"], is_business: false, credit_score_bucket: "good" }
  recommendations jsonb, -- ranked array of { card_id, score, reason, estimated_annual_value }
  email text,
  converted_to_clerk_user_id text,
  created_at timestamptz default now(),
  expires_at timestamptz default (now() + interval '30 days')
);

-- Index for looking up sessions by clerk user
create index if not exists card_tool_sessions_clerk_user_id_idx on card_tool_sessions(clerk_user_id);

-- Index for expired session cleanup
create index if not exists card_tool_sessions_expires_at_idx on card_tool_sessions(expires_at);

-- RLS: server-only (see 20260524_enable_rls_server_tables.sql)
alter table credit_cards enable row level security;
alter table card_tool_sessions enable row level security;
