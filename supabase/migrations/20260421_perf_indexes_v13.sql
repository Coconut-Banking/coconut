-- Performance indexes v13: GIN trigram indexes for search v2 hot paths

-- Enable pg_trgm if not already (safe on Supabase — always available)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- transactions: GIN trigram index on embed_text for ILIKE fallback in fullTextSearch
-- lib/search/retrievers.ts fullTextSearch falls back to:
--   WHERE embed_text ILIKE '%keyword%'
-- A GIN trigram index turns this from a sequential scan into an index seek.
CREATE INDEX CONCURRENTLY IF NOT EXISTS transactions_embed_text_trgm_idx
  ON transactions USING GIN (embed_text gin_trgm_ops)
  WHERE embed_text IS NOT NULL;

-- transactions: GIN trigram index on normalized_merchant for fuzzy_search_merchant RPC
-- fuzzyMerchantSearch calls the fuzzy_search_merchant RPC which uses pg_trgm similarity
-- on normalized_merchant. GIN enables the similarity index scan.
CREATE INDEX CONCURRENTLY IF NOT EXISTS transactions_normalized_merchant_trgm_idx
  ON transactions USING GIN (normalized_merchant gin_trgm_ops)
  WHERE normalized_merchant IS NOT NULL;

-- transactions: GIN trigram index on merchant_name for ILIKE merchant searches
-- Used in various ILIKE merchant_name queries across the codebase
CREATE INDEX CONCURRENTLY IF NOT EXISTS transactions_merchant_name_trgm_idx
  ON transactions USING GIN (merchant_name gin_trgm_ops)
  WHERE merchant_name IS NOT NULL;
