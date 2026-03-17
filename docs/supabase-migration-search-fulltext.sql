-- ============================================================
-- Full-text search for transactions (hybrid retrieval)
-- Run in Supabase SQL Editor. Optional — improves NL search when
-- combined with vector search (see lib/search-engine.ts).
-- ============================================================

-- Add tsvector column for BM25-style ranking (merchant + raw + category)
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(merchant_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(raw_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(primary_category, '')), 'B')
  ) STORED;

CREATE INDEX IF NOT EXISTS tx_search_vector_idx
  ON transactions USING GIN(search_vector);

-- RPC: full-text search within user and date range
CREATE OR REPLACE FUNCTION fulltext_search_transactions(
  p_user_id    text,
  p_date_start date,
  p_date_end   date,
  p_query      text,
  p_limit      int default 50
)
RETURNS SETOF transactions
LANGUAGE sql
STABLE
AS $$
  SELECT *
  FROM transactions
  WHERE clerk_user_id = p_user_id
    AND date >= p_date_start
    AND date <= p_date_end
    AND search_vector IS NOT NULL
    AND search_vector @@ plainto_tsquery('english', p_query)
  ORDER BY ts_rank_cd(search_vector, plainto_tsquery('english', p_query)) DESC
  LIMIT p_limit;
$$;
