-- ============================================================
-- Coconut — Semantic Search v2 Migration
-- Run this entire file in the Supabase SQL Editor.
--
-- ALL CHANGES ARE ADDITIVE. No existing columns, indexes,
-- functions, or data are modified or dropped.
-- ============================================================

-- 1. Enable pg_trgm for fuzzy merchant matching
create extension if not exists pg_trgm;

-- 2. New columns on transactions (all nullable — existing rows unaffected)
alter table transactions add column if not exists rich_embedding vector(1536);
alter table transactions add column if not exists embed_text text;
alter table transactions add column if not exists search_vector tsvector;

-- 3. IVFFlat index for cosine similarity on rich_embedding
create index if not exists tx_rich_embedding_idx
  on transactions using ivfflat (rich_embedding vector_cosine_ops)
  with (lists = 100);

-- 4. GIN index for full-text search
create index if not exists tx_search_vector_idx
  on transactions using gin (search_vector);

-- 5. Trigram GIN index for fuzzy merchant matching
create index if not exists tx_merchant_trgm_idx
  on transactions using gin (normalized_merchant gin_trgm_ops);

-- 6. Trigger: auto-populate search_vector on insert/update
--    Combines raw_name, merchant_name, normalized_merchant,
--    primary_category, and detailed_category into a single tsvector.
create or replace function tx_search_vector_update() returns trigger
language plpgsql as $$
begin
  new.search_vector :=
    setweight(to_tsvector('english', coalesce(new.merchant_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(new.raw_name, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(new.normalized_merchant, '')), 'B') ||
    setweight(to_tsvector('english',
      coalesce(replace(new.primary_category, '_', ' '), '')), 'C') ||
    setweight(to_tsvector('english',
      coalesce(replace(new.detailed_category, '_', ' '), '')), 'C');
  return new;
end;
$$;

drop trigger if exists tx_search_vector_trigger on transactions;
create trigger tx_search_vector_trigger
  before insert or update of raw_name, merchant_name, normalized_merchant,
                              primary_category, detailed_category
  on transactions
  for each row
  execute function tx_search_vector_update();

-- 7. Backfill search_vector for existing rows that have it NULL
update transactions
  set search_vector =
    setweight(to_tsvector('english', coalesce(merchant_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(raw_name, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(normalized_merchant, '')), 'B') ||
    setweight(to_tsvector('english',
      coalesce(replace(primary_category, '_', ' '), '')), 'C') ||
    setweight(to_tsvector('english',
      coalesce(replace(detailed_category, '_', ' '), '')), 'C')
where search_vector is null;

-- ============================================================
-- New RPC functions (existing vector_search_transactions untouched)
-- ============================================================

-- 8. Vector search v2 — uses rich_embedding column
create or replace function vector_search_transactions_v2(
  p_user_id      text,
  p_embedding    vector(1536),
  p_date_start   date    default null,
  p_date_end     date    default null,
  p_amount_min   numeric default null,
  p_amount_max   numeric default null,
  p_limit        int     default 50
)
returns table (
  id                   uuid,
  plaid_transaction_id text,
  account_id           uuid,
  merchant_name        text,
  raw_name             text,
  normalized_merchant  text,
  amount               numeric,
  date                 date,
  primary_category     text,
  detailed_category    text,
  iso_currency_code    text,
  is_pending           boolean,
  embed_text           text,
  similarity           float8
)
language sql
security definer
as $$
  select
    t.id, t.plaid_transaction_id, t.account_id,
    t.merchant_name, t.raw_name, t.normalized_merchant,
    t.amount, t.date, t.primary_category, t.detailed_category,
    t.iso_currency_code, t.is_pending, t.embed_text,
    1 - (t.rich_embedding <=> p_embedding) as similarity
  from transactions t
  where t.clerk_user_id = p_user_id
    and t.rich_embedding is not null
    and (p_date_start is null or t.date >= p_date_start)
    and (p_date_end   is null or t.date <= p_date_end)
    and (p_amount_min is null or t.amount >= p_amount_min)
    and (p_amount_max is null or t.amount <= p_amount_max)
  order by t.rich_embedding <=> p_embedding
  limit p_limit;
$$;

-- 9. Full-text search
create or replace function fulltext_search_transactions(
  p_user_id      text,
  p_query        text,
  p_date_start   date    default null,
  p_date_end     date    default null,
  p_amount_min   numeric default null,
  p_amount_max   numeric default null,
  p_limit        int     default 50
)
returns table (
  id                   uuid,
  plaid_transaction_id text,
  account_id           uuid,
  merchant_name        text,
  raw_name             text,
  normalized_merchant  text,
  amount               numeric,
  date                 date,
  primary_category     text,
  detailed_category    text,
  iso_currency_code    text,
  is_pending           boolean,
  embed_text           text,
  rank                 float4
)
language sql
security definer
as $$
  select
    t.id, t.plaid_transaction_id, t.account_id,
    t.merchant_name, t.raw_name, t.normalized_merchant,
    t.amount, t.date, t.primary_category, t.detailed_category,
    t.iso_currency_code, t.is_pending, t.embed_text,
    ts_rank(t.search_vector, websearch_to_tsquery('english', p_query)) as rank
  from transactions t
  where t.clerk_user_id = p_user_id
    and t.search_vector @@ websearch_to_tsquery('english', p_query)
    and (p_date_start is null or t.date >= p_date_start)
    and (p_date_end   is null or t.date <= p_date_end)
    and (p_amount_min is null or t.amount >= p_amount_min)
    and (p_amount_max is null or t.amount <= p_amount_max)
  order by rank desc
  limit p_limit;
$$;

-- 10. Fuzzy merchant search via trigram similarity
create or replace function fuzzy_search_merchant(
  p_user_id         text,
  p_merchant_query  text,
  p_date_start      date    default null,
  p_date_end        date    default null,
  p_amount_min      numeric default null,
  p_amount_max      numeric default null,
  p_similarity_min  float4  default 0.3,
  p_limit           int     default 30
)
returns table (
  id                   uuid,
  plaid_transaction_id text,
  account_id           uuid,
  merchant_name        text,
  raw_name             text,
  normalized_merchant  text,
  amount               numeric,
  date                 date,
  primary_category     text,
  detailed_category    text,
  iso_currency_code    text,
  is_pending           boolean,
  embed_text           text,
  sim                  float4
)
language sql
security definer
as $$
  select
    t.id, t.plaid_transaction_id, t.account_id,
    t.merchant_name, t.raw_name, t.normalized_merchant,
    t.amount, t.date, t.primary_category, t.detailed_category,
    t.iso_currency_code, t.is_pending, t.embed_text,
    similarity(t.normalized_merchant, lower(p_merchant_query)) as sim
  from transactions t
  where t.clerk_user_id = p_user_id
    and similarity(t.normalized_merchant, lower(p_merchant_query)) >= p_similarity_min
    and (p_date_start is null or t.date >= p_date_start)
    and (p_date_end   is null or t.date <= p_date_end)
    and (p_amount_min is null or t.amount >= p_amount_min)
    and (p_amount_max is null or t.amount <= p_amount_max)
  order by sim desc
  limit p_limit;
$$;

-- ============================================================
-- ROLLBACK (safe undo — run only if you need to revert)
-- ============================================================
-- drop trigger if exists tx_search_vector_trigger on transactions;
-- drop function if exists tx_search_vector_update;
-- drop function if exists vector_search_transactions_v2;
-- drop function if exists fulltext_search_transactions;
-- drop function if exists fuzzy_search_merchant;
-- drop index if exists tx_rich_embedding_idx;
-- drop index if exists tx_search_vector_idx;
-- drop index if exists tx_merchant_trgm_idx;
-- alter table transactions drop column if exists rich_embedding;
-- alter table transactions drop column if exists embed_text;
-- alter table transactions drop column if exists search_vector;
