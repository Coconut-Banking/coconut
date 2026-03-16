-- ============================================================
-- Search Enrichment Migration
-- Adds Plaid fields we were dropping + BM25 full-text search
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. Add enriched Plaid fields to transactions
alter table transactions add column if not exists payment_channel text;
alter table transactions add column if not exists authorized_date date;
alter table transactions add column if not exists city text;
alter table transactions add column if not exists region text;
alter table transactions add column if not exists postal_code text;
alter table transactions add column if not exists country text;
alter table transactions add column if not exists merchant_entity_id text;
alter table transactions add column if not exists website text;
alter table transactions add column if not exists category_confidence text;
alter table transactions add column if not exists pending_transaction_id text;
alter table transactions add column if not exists counterparty_name text;
alter table transactions add column if not exists counterparty_type text;
alter table transactions add column if not exists counterparty_website text;
alter table transactions add column if not exists counterparty_logo_url text;

-- 2. BM25 full-text search column + index
alter table transactions add column if not exists search_text tsvector;

create or replace function transactions_search_text_trigger() returns trigger as $$
begin
  NEW.search_text := to_tsvector('english',
    coalesce(NEW.merchant_name, '') || ' ' ||
    coalesce(NEW.raw_name, '') || ' ' ||
    coalesce(NEW.normalized_merchant, '') || ' ' ||
    coalesce(replace(NEW.primary_category, '_', ' '), '') || ' ' ||
    coalesce(replace(NEW.detailed_category, '_', ' '), '') || ' ' ||
    coalesce(NEW.city, '') || ' ' ||
    coalesce(NEW.region, '') || ' ' ||
    coalesce(NEW.counterparty_name, '')
  );
  return NEW;
end;
$$ language plpgsql;

drop trigger if exists transactions_search_text_update on transactions;
create trigger transactions_search_text_update
  before insert or update on transactions
  for each row execute function transactions_search_text_trigger();

-- Backfill existing rows
update transactions set search_text = to_tsvector('english',
  coalesce(merchant_name, '') || ' ' ||
  coalesce(raw_name, '') || ' ' ||
  coalesce(normalized_merchant, '') || ' ' ||
  coalesce(replace(primary_category, '_', ' '), '') || ' ' ||
  coalesce(replace(detailed_category, '_', ' '), '') || ' ' ||
  coalesce(city, '') || ' ' ||
  coalesce(region, '')
) where search_text is null;

-- GIN index for fast full-text search
create index if not exists tx_search_text_idx on transactions using gin(search_text);

-- 3. Indexes for new columns
create index if not exists tx_payment_channel_idx on transactions(clerk_user_id, payment_channel);
create index if not exists tx_city_idx on transactions(clerk_user_id, city);
create index if not exists tx_pending_tx_id_idx on transactions(pending_transaction_id);
create index if not exists tx_merchant_entity_idx on transactions(merchant_entity_id);

-- 4. Matryoshka 256-dim embeddings (6x smaller, 3x faster)
-- Drop old index, change column type, recreate index
-- NOTE: This requires re-embedding all existing transactions (set embedding = null, re-run sync)
drop index if exists tx_embedding_idx;
alter table transactions alter column embedding type vector(256) using null;
create index if not exists tx_embedding_idx on transactions using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- Update the vector search function for 256-dim
create or replace function vector_search_transactions(
  p_user_id    text,
  p_embedding  vector(256),
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

-- 5. BM25 search function
create or replace function bm25_search_transactions(
  p_user_id text,
  p_query text,
  p_date_start date default null,
  p_date_end date default null,
  p_limit int default 50
)
returns table (
  id uuid,
  plaid_transaction_id text,
  merchant_name text,
  raw_name text,
  amount numeric,
  date date,
  primary_category text,
  detailed_category text,
  iso_currency_code text,
  is_pending boolean,
  rank real
)
language sql
security definer
as $$
  select
    t.id, t.plaid_transaction_id, t.merchant_name, t.raw_name,
    t.amount, t.date, t.primary_category, t.detailed_category,
    t.iso_currency_code, t.is_pending,
    ts_rank(t.search_text, websearch_to_tsquery('english', p_query)) as rank
  from transactions t
  where t.clerk_user_id = p_user_id
    and t.search_text @@ websearch_to_tsquery('english', p_query)
    and (p_date_start is null or t.date >= p_date_start)
    and (p_date_end is null or t.date <= p_date_end)
  order by rank desc
  limit p_limit;
$$;
