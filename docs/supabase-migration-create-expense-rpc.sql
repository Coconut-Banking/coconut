-- RPC: create_manual_expense
-- Collapses membership check + 3 inserts (transaction, split_transaction,
-- split_shares) into a single database round trip.
-- Run in Supabase SQL Editor.

CREATE OR REPLACE FUNCTION create_manual_expense(
  p_clerk_user_id  text,
  p_group_id       uuid,
  p_amount         numeric,
  p_description    text,
  p_currency       text       DEFAULT 'USD',
  p_date           date       DEFAULT CURRENT_DATE,
  p_category       text       DEFAULT NULL,
  p_notes          text       DEFAULT NULL,
  p_receipt_url    text       DEFAULT NULL,
  p_payer_member_id uuid      DEFAULT NULL,
  p_shares         jsonb      DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_my_member_id  uuid;
  v_payer         uuid;
  v_plaid_id      text;
  v_tx_id         uuid;
  v_split_tx_id   uuid;
  v_share_count   int;
BEGIN
  -- 1. Access check: caller must be a member of the group
  SELECT id INTO v_my_member_id
    FROM group_members
   WHERE group_id = p_group_id
     AND user_id  = p_clerk_user_id;

  IF v_my_member_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Group not found');
  END IF;

  -- 2. Resolve payer (default to caller's member id)
  v_payer := COALESCE(p_payer_member_id, v_my_member_id);

  IF p_payer_member_id IS NOT NULL AND p_payer_member_id <> v_my_member_id THEN
    IF NOT EXISTS (
      SELECT 1 FROM group_members
       WHERE group_id = p_group_id AND id = p_payer_member_id
    ) THEN
      RETURN jsonb_build_object('error', 'Payer not in group');
    END IF;
  END IF;

  -- 3. Insert transaction row
  v_plaid_id := 'manual_' || gen_random_uuid()::text;

  INSERT INTO transactions (
    clerk_user_id, plaid_transaction_id,
    merchant_name, raw_name, amount, date,
    is_pending, primary_category, detailed_category
  ) VALUES (
    p_clerk_user_id, v_plaid_id,
    p_description, p_description, -p_amount, p_date,
    false, p_category, null
  ) RETURNING id INTO v_tx_id;

  -- 4. Insert split_transaction row
  INSERT INTO split_transactions (
    group_id, transaction_id, created_by,
    iso_currency_code, payer_member_id, date,
    notes, category, receipt_url
  ) VALUES (
    p_group_id, v_tx_id, p_clerk_user_id,
    p_currency, v_payer, p_date,
    p_notes, p_category, p_receipt_url
  ) RETURNING id INTO v_split_tx_id;

  -- 5. Insert split_shares from the JSONB array
  INSERT INTO split_shares (split_transaction_id, member_id, amount)
  SELECT v_split_tx_id,
         (s->>'memberId')::uuid,
         (s->>'amount')::numeric
    FROM jsonb_array_elements(p_shares) AS s;

  GET DIAGNOSTICS v_share_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'splitTxId', v_split_tx_id,
    'txId',      v_tx_id,
    'shares',    v_share_count
  );
END;
$$;
