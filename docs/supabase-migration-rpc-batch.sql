-- Batch RPC migration: collapse sequential PostgREST calls into single DB round trips.
-- Run in Supabase SQL Editor.

-- ═══════════════════════════════════════════════════════════════
-- 1. split_bank_transaction
--    POST /api/split-transactions
--    Replaces: access check + dedupe check + INSERT split_tx + race check + INSERT shares
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION split_bank_transaction(
  p_clerk_user_id  text,
  p_group_id       uuid,
  p_transaction_id uuid,
  p_shares         jsonb  -- [{"memberId": "uuid", "amount": 1.50}, ...]
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_split_id    uuid;
  v_tx_currency text;
  v_share_count int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM group_members
     WHERE group_id = p_group_id AND user_id = p_clerk_user_id
  ) THEN
    RETURN jsonb_build_object('error', 'Group not found');
  END IF;

  SELECT iso_currency_code INTO v_tx_currency
    FROM transactions
   WHERE id = p_transaction_id AND clerk_user_id = p_clerk_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Transaction not found');
  END IF;

  IF EXISTS (
    SELECT 1 FROM split_transactions
     WHERE group_id = p_group_id AND transaction_id = p_transaction_id
  ) THEN
    RETURN jsonb_build_object('error', 'Already split');
  END IF;

  INSERT INTO split_transactions (group_id, transaction_id, created_by, iso_currency_code)
  VALUES (p_group_id, p_transaction_id, p_clerk_user_id, COALESCE(v_tx_currency, 'USD'))
  RETURNING id INTO v_split_id;

  INSERT INTO split_shares (split_transaction_id, member_id, amount)
  SELECT v_split_id, (s->>'memberId')::uuid, round((s->>'amount')::numeric, 2)
    FROM jsonb_array_elements(p_shares) AS s
   WHERE (s->>'amount')::numeric > 0;

  GET DIAGNOSTICS v_share_count = ROW_COUNT;

  RETURN jsonb_build_object('splitTxId', v_split_id, 'shares', v_share_count);
END;
$$;


-- ═══════════════════════════════════════════════════════════════
-- 2. delete_split_transaction
--    DELETE /api/split-transactions/[id]
--    Replaces: SELECT split → access check → SELECT tx owner → DELETE split →
--              COUNT remaining → DELETE settlements → DELETE transaction
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION delete_split_transaction(
  p_clerk_user_id text,
  p_split_id      uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_group_id        uuid;
  v_transaction_id  uuid;
  v_linked_tx_owner text;
  v_remaining       int;
BEGIN
  SELECT group_id, transaction_id
    INTO v_group_id, v_transaction_id
    FROM split_transactions WHERE id = p_split_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Not found');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM group_members WHERE group_id = v_group_id AND user_id = p_clerk_user_id
    UNION ALL
    SELECT 1 FROM groups WHERE id = v_group_id AND owner_id = p_clerk_user_id
    LIMIT 1
  ) THEN
    RETURN jsonb_build_object('error', 'Not found');
  END IF;

  IF v_transaction_id IS NOT NULL THEN
    SELECT clerk_user_id INTO v_linked_tx_owner
      FROM transactions WHERE id = v_transaction_id;
  END IF;

  -- CASCADE on split_shares FK handles share cleanup
  DELETE FROM split_transactions WHERE id = p_split_id;

  SELECT count(*)::int INTO v_remaining
    FROM split_transactions WHERE group_id = v_group_id;

  IF v_remaining = 0 THEN
    DELETE FROM settlements WHERE group_id = v_group_id;
  END IF;

  IF v_transaction_id IS NOT NULL THEN
    DELETE FROM transactions WHERE id = v_transaction_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'groupId', v_group_id,
    'linkedTxOwner', v_linked_tx_owner
  );
END;
$$;


-- ═══════════════════════════════════════════════════════════════
-- 3. update_split_transaction
--    PATCH /api/split-transactions/[id]
--    Replaces: SELECT split → access check → SELECT members → UPDATE tx ×2 →
--              UPDATE split_tx → DELETE shares → INSERT shares
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_split_transaction(
  p_clerk_user_id    text,
  p_split_id         uuid,
  p_description      text    DEFAULT NULL,
  p_amount           numeric DEFAULT NULL,
  p_payer_member_id  uuid    DEFAULT NULL,
  p_notes            text    DEFAULT NULL,
  p_category         text    DEFAULT NULL,
  p_receipt_url      text    DEFAULT NULL,
  p_clear_notes      boolean DEFAULT false,
  p_clear_category   boolean DEFAULT false,
  p_clear_receipt_url boolean DEFAULT false,
  p_shares           jsonb   DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_group_id       uuid;
  v_transaction_id uuid;
  v_has_tx         boolean;
BEGIN
  SELECT group_id, transaction_id
    INTO v_group_id, v_transaction_id
    FROM split_transactions WHERE id = p_split_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Not found');
  END IF;

  v_has_tx := v_transaction_id IS NOT NULL;

  IF NOT EXISTS (
    SELECT 1 FROM group_members WHERE group_id = v_group_id AND user_id = p_clerk_user_id
    UNION ALL
    SELECT 1 FROM groups WHERE id = v_group_id AND owner_id = p_clerk_user_id
    LIMIT 1
  ) THEN
    RETURN jsonb_build_object('error', 'Not found');
  END IF;

  IF p_payer_member_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM group_members WHERE group_id = v_group_id AND id = p_payer_member_id
    ) THEN
      RETURN jsonb_build_object('error', 'Payer not in group');
    END IF;
  END IF;

  -- Validate share members belong to group
  IF p_shares IS NOT NULL AND jsonb_array_length(p_shares) > 0 THEN
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_shares) AS s
       WHERE NOT EXISTS (
         SELECT 1 FROM group_members
          WHERE group_id = v_group_id AND id = (s->>'memberId')::uuid
       )
    ) THEN
      RETURN jsonb_build_object('error', 'Invalid member IDs in shares');
    END IF;
  END IF;

  IF v_has_tx THEN
    IF p_description IS NOT NULL THEN
      UPDATE transactions
         SET merchant_name = p_description, raw_name = p_description
       WHERE id = v_transaction_id;
    END IF;
    IF p_amount IS NOT NULL THEN
      UPDATE transactions SET amount = -p_amount WHERE id = v_transaction_id;
    END IF;
  END IF;

  UPDATE split_transactions SET
    payer_member_id = COALESCE(p_payer_member_id, payer_member_id),
    notes       = CASE WHEN p_clear_notes       THEN NULL WHEN p_notes       IS NOT NULL THEN p_notes       ELSE notes       END,
    category    = CASE WHEN p_clear_category    THEN NULL WHEN p_category    IS NOT NULL THEN p_category    ELSE category    END,
    receipt_url = CASE WHEN p_clear_receipt_url THEN NULL WHEN p_receipt_url IS NOT NULL THEN p_receipt_url ELSE receipt_url END,
    description = CASE WHEN NOT v_has_tx AND p_description IS NOT NULL THEN p_description ELSE description END,
    amount      = CASE WHEN NOT v_has_tx AND p_amount      IS NOT NULL THEN p_amount      ELSE amount      END
  WHERE id = p_split_id;

  IF p_shares IS NOT NULL AND jsonb_array_length(p_shares) > 0 THEN
    DELETE FROM split_shares WHERE split_transaction_id = p_split_id;
    INSERT INTO split_shares (split_transaction_id, member_id, amount)
    SELECT p_split_id, (s->>'memberId')::uuid, round((s->>'amount')::numeric, 2)
      FROM jsonb_array_elements(p_shares) AS s
     WHERE (s->>'amount')::numeric > 0;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', p_split_id, 'groupId', v_group_id);
END;
$$;


-- ═══════════════════════════════════════════════════════════════
-- 4. finish_receipt_split
--    POST /api/receipt/[id]/finish
--    Replaces: INSERT transaction → INSERT split_tx → INSERT shares
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION finish_receipt_split(
  p_clerk_user_id   text,
  p_group_id        uuid,
  p_payer_member_id uuid,
  p_merchant_name   text,
  p_total           numeric,
  p_currency        text DEFAULT 'USD',
  p_shares          jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_plaid_id    text;
  v_tx_id       uuid;
  v_split_tx_id uuid;
  v_share_count int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM group_members
     WHERE group_id = p_group_id AND user_id = p_clerk_user_id
  ) THEN
    RETURN jsonb_build_object('error', 'Not a member');
  END IF;

  v_plaid_id := 'manual_' || gen_random_uuid()::text;

  INSERT INTO transactions (
    clerk_user_id, plaid_transaction_id,
    merchant_name, raw_name, amount, date,
    is_pending, primary_category
  ) VALUES (
    p_clerk_user_id, v_plaid_id,
    p_merchant_name, p_merchant_name, -p_total, CURRENT_DATE,
    false, 'Food & Drink'
  ) RETURNING id INTO v_tx_id;

  INSERT INTO split_transactions (
    group_id, transaction_id, created_by,
    iso_currency_code, payer_member_id,
    description, amount
  ) VALUES (
    p_group_id, v_tx_id, p_clerk_user_id,
    p_currency, p_payer_member_id,
    p_merchant_name, p_total
  ) RETURNING id INTO v_split_tx_id;

  INSERT INTO split_shares (split_transaction_id, member_id, amount)
  SELECT v_split_tx_id, (s->>'memberId')::uuid, round((s->>'amount')::numeric, 2)
    FROM jsonb_array_elements(p_shares) AS s
   WHERE (s->>'amount')::numeric > 0;

  GET DIAGNOSTICS v_share_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'txId',      v_tx_id,
    'splitTxId', v_split_tx_id,
    'shares',    v_share_count
  );
END;
$$;


-- ═══════════════════════════════════════════════════════════════
-- 5. insert_settlement_checked
--    POST /api/settlements
--    Replaces: canAccessGroup (2 queries) + party check + INSERT
--    Balance computation stays in JS (too complex for SQL).
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION insert_settlement_checked(
  p_clerk_user_id      text,
  p_group_id           uuid,
  p_payer_member_id    uuid,
  p_receiver_member_id uuid,
  p_amount             numeric,
  p_method             text DEFAULT 'manual',
  p_currency           text DEFAULT 'USD'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_is_party   boolean;
  v_settlement jsonb;
  v_id         uuid;
BEGIN
  -- Verify caller is one of the parties AND a member of the group
  SELECT EXISTS (
    SELECT 1 FROM group_members
     WHERE group_id = p_group_id
       AND user_id  = p_clerk_user_id
       AND id IN (p_payer_member_id, p_receiver_member_id)
  ) INTO v_is_party;

  IF NOT v_is_party THEN
    RETURN jsonb_build_object('error', 'Forbidden');
  END IF;

  INSERT INTO settlements (
    group_id, payer_member_id, receiver_member_id,
    amount, method, status, iso_currency_code
  ) VALUES (
    p_group_id, p_payer_member_id, p_receiver_member_id,
    p_amount,
    CASE WHEN p_method IN ('manual','in_person','online') THEN p_method ELSE 'manual' END,
    'completed', p_currency
  ) RETURNING id INTO v_id;

  SELECT to_jsonb(s) INTO v_settlement
    FROM settlements s WHERE s.id = v_id;

  RETURN v_settlement;
END;
$$;
