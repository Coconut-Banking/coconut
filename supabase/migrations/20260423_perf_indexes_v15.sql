-- Performance indexes v15: pgvector IVFFlat + tsvector GIN for search v2

-- Ensure pgvector extension is available (Supabase enables this by default)
CREATE EXTENSION IF NOT EXISTS vector;

-- IVFFlat index on rich_embedding for vector similarity search (search v2)
-- lib/search/retrievers.ts vectorSearch() calls vector_search_transactions_v2 RPC
-- which does: ORDER BY rich_embedding <=> p_embedding LIMIT p_limit
-- Without this index, every query is a sequential scan (O(n) distance comparisons).
-- lists=100 is optimal for up to ~1M rows; adjust to sqrt(rowcount) if needed.
-- Uses conditional creation so it's safe if the column doesn't exist yet.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'rich_embedding'
  ) THEN
    EXECUTE 'CREATE INDEX CONCURRENTLY IF NOT EXISTS tx_rich_embedding_idx
      ON transactions USING ivfflat (rich_embedding vector_cosine_ops)
      WITH (lists = 100)';
  END IF;
END $$;

-- GIN index on search_vector for full-text search (search v2 fullTextSearch RPC)
-- lib/search/retrievers.ts fullTextSearch() calls fulltext_search_transactions RPC
-- which does: WHERE search_vector @@ plainto_tsquery(p_query)
-- GIN is required for efficient tsvector @@ queries.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'search_vector'
  ) THEN
    EXECUTE 'CREATE INDEX CONCURRENTLY IF NOT EXISTS tx_search_vector_gin_idx
      ON transactions USING GIN (search_vector)';
  END IF;
END $$;
