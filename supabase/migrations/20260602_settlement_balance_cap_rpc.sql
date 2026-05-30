-- Atomic settlement cap: prevents over-settlement when two POST /api/settlements run concurrently.
-- Mirrors lib/group-balances.ts + lib/split-balances.ts computePairwiseBalance (receiver ← payer).

CREATE OR REPLACE FUNCTION get_pairwise_settlement_max(
  p_group_id           uuid,
  p_receiver_member_id uuid,
  p_payer_member_id    uuid,
  p_currency           text DEFAULT 'USD'
) RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_currency  text := upper(trim(coalesce(p_currency, 'USD')));
  v_is_sw     boolean := false;
  v_expenses  numeric := 0;
  v_settled   numeric := 0;
BEGIN
  SELECT (g.source = 'splitwise' AND g.external_id IS NOT NULL)
    INTO v_is_sw
  FROM groups g
  WHERE g.id = p_group_id;

  -- Deduped splits (tx: id for bank-linked; split: id for manual/SW rows)
  WITH split_rows AS (
    SELECT
      st.id,
      COALESCE(NULLIF(st.transaction_id::text, ''), 'split:' || st.id::text) AS dedupe_key,
      COALESCE(st.payer_member_id, gm_tx.id) AS effective_payer,
      upper(trim(coalesce(st.iso_currency_code, 'USD'))) AS cur
    FROM split_transactions st
    LEFT JOIN transactions t ON t.id = st.transaction_id
    LEFT JOIN group_members gm_tx
      ON gm_tx.group_id = st.group_id AND gm_tx.user_id = t.clerk_user_id
    WHERE st.group_id = p_group_id
      AND (NOT v_is_sw OR st.source IS DISTINCT FROM 'splitwise')
  ),
  deduped AS (
    SELECT DISTINCT ON (dedupe_key) id, effective_payer, cur
    FROM split_rows
    WHERE cur = v_currency
    ORDER BY dedupe_key, id
  )
  SELECT coalesce(sum(
    CASE
      WHEN d.effective_payer = p_receiver_member_id AND ss.member_id = p_payer_member_id
        THEN ss.amount
      WHEN d.effective_payer = p_payer_member_id AND ss.member_id = p_receiver_member_id
        THEN -ss.amount
      ELSE 0
    END
  ), 0)
  INTO v_expenses
  FROM deduped d
  JOIN split_shares ss ON ss.split_transaction_id = d.id;

  SELECT coalesce(sum(
    CASE
      WHEN s.payer_member_id = p_receiver_member_id AND s.receiver_member_id = p_payer_member_id
        THEN s.amount
      WHEN s.payer_member_id = p_payer_member_id AND s.receiver_member_id = p_receiver_member_id
        THEN -s.amount
      ELSE 0
    END
  ), 0)
  INTO v_settled
  FROM settlements s
  WHERE s.group_id = p_group_id
    AND s.status = 'completed'
    AND upper(trim(coalesce(s.iso_currency_code, 'USD'))) = v_currency
    AND (NOT v_is_sw OR s.method IS DISTINCT FROM 'splitwise');

  RETURN round(greatest(0, v_expenses + v_settled)::numeric, 2);
END;
$$;


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
SET search_path = public
AS $$
DECLARE
  v_is_party        boolean;
  v_max             numeric;
  v_insert_amount   numeric;
  v_id              uuid;
  v_settlement      jsonb;
  v_lock_key        bigint;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('error', 'Invalid amount', 'max_amount', 0);
  END IF;

  -- Serialize concurrent settlements for the same pair + currency in this group
  v_lock_key := hashtext(
    p_group_id::text || '|' || p_payer_member_id::text || '|' ||
    p_receiver_member_id::text || '|' || upper(trim(coalesce(p_currency, 'USD')))
  );
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT EXISTS (
    SELECT 1 FROM group_members
     WHERE group_id = p_group_id
       AND user_id  = p_clerk_user_id
       AND id IN (p_payer_member_id, p_receiver_member_id)
  ) INTO v_is_party;

  IF NOT v_is_party THEN
    RETURN jsonb_build_object('error', 'Forbidden');
  END IF;

  v_max := get_pairwise_settlement_max(
    p_group_id, p_receiver_member_id, p_payer_member_id, p_currency
  );

  IF v_max < 0.01 THEN
    RETURN jsonb_build_object(
      'error', 'Already settled between these members in this currency',
      'max_amount', v_max
    );
  END IF;

  v_insert_amount := least(round(p_amount::numeric, 2), v_max);

  IF v_insert_amount < 0.01 THEN
    RETURN jsonb_build_object('error', 'Amount too small', 'max_amount', v_max);
  END IF;

  INSERT INTO settlements (
    group_id, payer_member_id, receiver_member_id,
    amount, method, status, iso_currency_code
  ) VALUES (
    p_group_id, p_payer_member_id, p_receiver_member_id,
    v_insert_amount,
    CASE WHEN p_method IN ('manual','in_person','online','stripe') THEN p_method ELSE 'manual' END,
    'completed',
    upper(trim(coalesce(p_currency, 'USD')))
  ) RETURNING id INTO v_id;

  SELECT to_jsonb(s) INTO v_settlement
    FROM settlements s WHERE s.id = v_id;

  RETURN v_settlement;
END;
$$;
