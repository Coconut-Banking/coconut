-- ============================================================
-- Coconut — Performance Migration v2
-- Run in Supabase SQL Editor in TWO steps:
--   STEP 1: Run this entire file (indexes, functions, ANALYZE)
--   No BEGIN/COMMIT wrapper — required for CONCURRENTLY indexes.
--   All statements are idempotent (IF NOT EXISTS / OR REPLACE).
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. TRANSACTIONS — the #1 hottest table
-- ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tx_user_date_id_desc
  ON transactions (clerk_user_id, date DESC, id DESC);

-- ────────────────────────────────────────────────────────────
-- 2. SUBSCRIPTION_TRANSACTIONS — zero indexes, queried on every tx fetch
-- ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_sub_tx_transaction_id
  ON subscription_transactions (transaction_id);

CREATE INDEX IF NOT EXISTS idx_sub_tx_subscription_id
  ON subscription_transactions (subscription_id);

-- ────────────────────────────────────────────────────────────
-- 3. SUBSCRIPTIONS — dashboard + plaid/transactions hot path
-- ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_active
  ON subscriptions (clerk_user_id, next_due_date)
  WHERE status = 'active';

-- ────────────────────────────────────────────────────────────
-- 4. SPLIT_TRANSACTIONS — transaction_id lookup in hot path
-- ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_split_tx_transaction_id
  ON split_transactions (transaction_id)
  WHERE transaction_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 5. EMAIL_RECEIPTS — paginated list + transaction matching
-- ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_email_receipts_user_parsed
  ON email_receipts (clerk_user_id, parsed_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_receipts_user_tx
  ON email_receipts (clerk_user_id, transaction_id)
  WHERE transaction_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 6. GROUP_MEMBERS — composite for access check pattern
-- ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_group_members_user_group
  ON group_members (user_id, group_id)
  WHERE user_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 7. ACCOUNTS — dashboard + plaid/accounts hot path
-- ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_accounts_user_plaid_item
  ON accounts (clerk_user_id, plaid_item_id);

-- ────────────────────────────────────────────────────────────
-- 8. TRANSACTIONS — pending transaction dedup in Plaid sync
-- ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tx_pending
  ON transactions (clerk_user_id, pending_transaction_id)
  WHERE is_pending = true;

-- ────────────────────────────────────────────────────────────
-- 9. DROP DUPLICATE INDEXES (save write overhead)
-- ────────────────────────────────────────────────────────────
-- Uncomment after verifying both exist in your DB:
-- DROP INDEX IF EXISTS idx_plaid_items_clerk_user_id;
-- DROP INDEX IF EXISTS idx_group_members_group_id;

-- ────────────────────────────────────────────────────────────
-- 10. SERVER-SIDE FUNCTION: get_accessible_group_ids
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_accessible_group_ids(p_user_id text)
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  SELECT id FROM groups WHERE owner_id = p_user_id
  UNION
  SELECT group_id FROM group_members WHERE user_id = p_user_id
$$;

-- ────────────────────────────────────────────────────────────
-- 11. SERVER-SIDE FUNCTION: get_group_summary_data
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_group_summary_data(p_user_id text, p_split_limit int DEFAULT 25000)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
AS $$
DECLARE
  v_group_ids uuid[];
  v_split_ids uuid[];
  result jsonb;
BEGIN
  SELECT array_agg(gid) INTO v_group_ids
  FROM get_accessible_group_ids(p_user_id) AS gid;

  IF v_group_ids IS NULL OR array_length(v_group_ids, 1) IS NULL THEN
    RETURN jsonb_build_object(
      'groups', '[]'::jsonb,
      'members', '[]'::jsonb,
      'splits', '[]'::jsonb,
      'shares', '[]'::jsonb,
      'settlements', '[]'::jsonb
    );
  END IF;

  SELECT array_agg(id) INTO v_split_ids
  FROM (
    SELECT id FROM split_transactions
    WHERE group_id = ANY(v_group_ids)
    ORDER BY created_at DESC
    LIMIT p_split_limit
  ) sub;

  SELECT jsonb_build_object(
    'groups', COALESCE((
      SELECT jsonb_agg(row_to_json(g))
      FROM (
        SELECT id, owner_id, name, group_type, invite_token, source, image_url, archived_at, created_at
        FROM groups WHERE id = ANY(v_group_ids)
        ORDER BY created_at DESC
      ) g
    ), '[]'::jsonb),
    'members', COALESCE((
      SELECT jsonb_agg(row_to_json(m))
      FROM (
        SELECT id, group_id, user_id, email, display_name, venmo_username, cashapp_cashtag, paypal_username
        FROM group_members WHERE group_id = ANY(v_group_ids)
      ) m
    ), '[]'::jsonb),
    'splits', COALESCE((
      SELECT jsonb_agg(row_to_json(s))
      FROM (
        SELECT id, group_id, transaction_id, created_by, payer_member_id, amount, description,
               iso_currency_code, receipt_url, created_at, source
        FROM split_transactions
        WHERE group_id = ANY(v_group_ids)
        ORDER BY created_at DESC
        LIMIT p_split_limit
      ) s
    ), '[]'::jsonb),
    'shares', COALESCE((
      SELECT jsonb_agg(row_to_json(sh))
      FROM (
        SELECT split_transaction_id, member_id, amount
        FROM split_shares
        WHERE v_split_ids IS NOT NULL
          AND split_transaction_id = ANY(v_split_ids)
      ) sh
    ), '[]'::jsonb),
    'settlements', COALESCE((
      SELECT jsonb_agg(row_to_json(se))
      FROM (
        SELECT id, group_id, payer_member_id, receiver_member_id, amount, iso_currency_code, method, status
        FROM settlements
        WHERE group_id = ANY(v_group_ids)
          AND status = 'completed'
      ) se
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 12. ANALYZE — tell the query planner about the new indexes
-- ────────────────────────────────────────────────────────────
ANALYZE transactions;
ANALYZE subscription_transactions;
ANALYZE subscriptions;
ANALYZE split_transactions;
ANALYZE split_shares;
ANALYZE email_receipts;
ANALYZE group_members;
ANALYZE accounts;
ANALYZE settlements;

-- ============================================================
-- POST-MIGRATION VERIFICATION
-- Run these to confirm indexes are being used:
--
-- EXPLAIN ANALYZE
-- SELECT id, date, amount, merchant_name
-- FROM transactions
-- WHERE clerk_user_id = 'your_user_id'
-- ORDER BY date DESC, id DESC
-- LIMIT 2000;
--
-- Expected: Index Scan using idx_tx_user_date_id_desc
-- If you see Seq Scan, run ANALYZE transactions; and retry.
--
-- EXPLAIN ANALYZE
-- SELECT transaction_id
-- FROM subscription_transactions
-- WHERE transaction_id = ANY(ARRAY['uuid1', 'uuid2']::uuid[]);
--
-- Expected: Index Scan using idx_sub_tx_transaction_id
-- ============================================================

-- ============================================================
-- IMPACT ESTIMATE
--
-- | Change                              | Affected Route(s)              | Expected Improvement      |
-- |-------------------------------------|--------------------------------|---------------------------|
-- | idx_tx_user_date_id_desc            | plaid/transactions, search     | 3-5x faster (eliminate sort) |
-- | idx_sub_tx_transaction_id           | plaid/transactions             | 10-50x (seq scan → index) |
-- | idx_subscriptions_user_active       | dashboard, plaid/transactions  | 5-10x for active filter   |
-- | idx_split_tx_transaction_id         | plaid/transactions             | 10-50x (seq scan → index) |
-- | idx_email_receipts_user_parsed      | email-receipts list            | 3-5x (eliminate sort)     |
-- | idx_group_members_user_group        | every group API call           | 2-3x (covers access check)|
-- | get_accessible_group_ids()          | every group API call           | 2x (1 round-trip vs 2)   |
-- | get_group_summary_data()            | groups/summary (heaviest route)| 3-5x (1 call vs 5-6)     |
-- | Drop duplicate indexes              | all writes to those tables     | ~5-10% faster inserts     |
-- ============================================================
