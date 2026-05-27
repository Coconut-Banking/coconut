-- ============================================================
-- Coconut — Performance Sprint Migration
-- Run in Supabase SQL Editor.
-- All statements are idempotent (IF NOT EXISTS / OR REPLACE).
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. INDEX: split_transactions(transaction_id)
--    The Plaid transactions route does IN(transaction_id, txIds)
--    with up to 2000 IDs. The existing composite
--    (group_id, transaction_id) doesn't help for
--    transaction_id-only lookups.
-- ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_split_tx_transaction_id_only
  ON split_transactions (transaction_id);


-- ────────────────────────────────────────────────────────────
-- 2. INDEX: transactions(clerk_user_id) WHERE rich_embedding IS NULL
--    Search backfill probes this partial condition on every
--    /api/search/v2 call to find un-embedded rows.
-- ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tx_user_no_embedding
  ON transactions (clerk_user_id)
  WHERE rich_embedding IS NULL;


-- ────────────────────────────────────────────────────────────
-- 3. INDEX: transactions(clerk_user_id, date DESC, id DESC)
--    Composite covering the main bank feed ordering query.
--    NOTE: perf-v2 already created idx_tx_user_date_id_desc
--    with the same definition — this is here for completeness.
--    IF NOT EXISTS makes it a no-op if already present.
-- ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tx_user_date_id_desc
  ON transactions (clerk_user_id, date DESC, id DESC);


-- ────────────────────────────────────────────────────────────
-- 4. RPC: batch_update_merchant_llm
--    Bulk-updates transactions.merchant_display_llm from a
--    JSONB array of {id, value} objects in a single query
--    instead of per-row updates.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION batch_update_merchant_llm(
  p_clerk_user_id TEXT,
  p_updates       JSONB   -- [{"id": "uuid", "value": "Display Name"}, ...]
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_updated INT;
  v_updates JSONB;
BEGIN
  -- Accept a JSON array or a JSON string containing an array (legacy double-encoding).
  v_updates := CASE jsonb_typeof(p_updates)
    WHEN 'array' THEN p_updates
    WHEN 'string' THEN (p_updates #>> '{}')::jsonb
    ELSE '[]'::jsonb
  END;

  IF jsonb_typeof(v_updates) IS DISTINCT FROM 'array' THEN
    RETURN 0;
  END IF;

  UPDATE transactions AS t
     SET merchant_display_llm = elem.value
    FROM (
      SELECT (e->>'id')::uuid   AS id,
             (e->>'value')::text AS value
        FROM jsonb_array_elements(v_updates) AS e
    ) AS elem
   WHERE t.id = elem.id
     AND t.clerk_user_id = p_clerk_user_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;


-- ────────────────────────────────────────────────────────────
-- 5. RPC: get_recent_activity_splits
--    Returns the UNION of date-ordered and created_at-ordered
--    split_transactions for the given group IDs, deduplicated
--    by id. Used by the activity feed to catch both dated and
--    undated expenses.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_recent_activity_splits(
  p_group_ids UUID[],
  p_limit     INT DEFAULT 500
) RETURNS TABLE(
  id                UUID,
  group_id          UUID,
  transaction_id    UUID,
  created_by        TEXT,
  created_at        TIMESTAMPTZ,
  date              DATE,
  description       TEXT,
  payer_member_id   UUID,
  amount            NUMERIC,
  iso_currency_code TEXT,
  receipt_url       TEXT
)
LANGUAGE plpgsql STABLE SECURITY INVOKER
AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT ON (combined.id)
         combined.id,
         combined.group_id,
         combined.transaction_id,
         combined.created_by,
         combined.created_at,
         combined.date,
         combined.description,
         combined.payer_member_id,
         combined.amount,
         combined.iso_currency_code,
         combined.receipt_url
    FROM (
      -- Recent by date (catches dated expenses)
      SELECT s.id, s.group_id, s.transaction_id, s.created_by,
             s.created_at, s.date, s.description, s.payer_member_id,
             s.amount, s.iso_currency_code, s.receipt_url
        FROM split_transactions s
       WHERE s.group_id = ANY(p_group_ids)
         AND s.date IS NOT NULL
       ORDER BY s.date DESC
       LIMIT p_limit

      UNION ALL

      -- Recent by created_at (catches undated / manual expenses)
      SELECT s.id, s.group_id, s.transaction_id, s.created_by,
             s.created_at, s.date, s.description, s.payer_member_id,
             s.amount, s.iso_currency_code, s.receipt_url
        FROM split_transactions s
       WHERE s.group_id = ANY(p_group_ids)
       ORDER BY s.created_at DESC
       LIMIT p_limit
    ) AS combined
   ORDER BY combined.id;
END;
$$;


-- ────────────────────────────────────────────────────────────
-- 6. ANALYZE — refresh planner statistics for affected tables
-- ────────────────────────────────────────────────────────────
ANALYZE transactions;
ANALYZE split_transactions;


-- ============================================================
-- POST-MIGRATION VERIFICATION
--
-- 1. Verify split_transactions transaction_id-only index:
--    EXPLAIN ANALYZE
--    SELECT * FROM split_transactions
--    WHERE transaction_id = ANY(ARRAY['<uuid>']::uuid[]);
--    Expected: Index Scan using idx_split_tx_transaction_id_only
--
-- 2. Verify partial embedding index:
--    EXPLAIN ANALYZE
--    SELECT id FROM transactions
--    WHERE clerk_user_id = '<user>' AND rich_embedding IS NULL
--    LIMIT 1;
--    Expected: Index Scan using idx_tx_user_no_embedding
--
-- 3. Test batch_update_merchant_llm:
--    SELECT batch_update_merchant_llm(
--      '<clerk_user_id>',
--      '[{"id":"<tx_uuid>","value":"Test Merchant"}]'::jsonb
--    );
--    Expected: returns 1 (number of rows updated)
--
-- 4. Test get_recent_activity_splits:
--    SELECT * FROM get_recent_activity_splits(
--      ARRAY['<group_uuid>']::uuid[], 10
--    );
--    Expected: up to 10 distinct split_transaction rows
-- ============================================================
