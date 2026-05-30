-- Race-safe Stripe settlements: same advisory lock + balance cap as manual settlements.
-- Idempotent on external_reference (webhook + terminal record-settlement duplicate calls).

CREATE OR REPLACE FUNCTION insert_stripe_settlement_checked(
  p_group_id            uuid,
  p_payer_member_id     uuid,
  p_receiver_member_id  uuid,
  p_amount              numeric,
  p_currency            text DEFAULT 'USD',
  p_external_reference  text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ref             text;
  v_existing        jsonb;
  v_max             numeric;
  v_insert_amount   numeric;
  v_id              uuid;
  v_settlement      jsonb;
  v_lock_key        bigint;
BEGIN
  v_ref := trim(coalesce(p_external_reference, ''));
  IF v_ref = '' THEN
    RETURN jsonb_build_object('error', 'external_reference required');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('error', 'Invalid amount', 'max_amount', 0);
  END IF;

  SELECT to_jsonb(s) || jsonb_build_object('already_exists', true)
    INTO v_existing
  FROM settlements s
  WHERE s.external_reference = v_ref
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  v_lock_key := hashtext(
    p_group_id::text || '|' || p_payer_member_id::text || '|' ||
    p_receiver_member_id::text || '|' || upper(trim(coalesce(p_currency, 'USD')))
  );
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT to_jsonb(s) || jsonb_build_object('already_exists', true)
    INTO v_existing
  FROM settlements s
  WHERE s.external_reference = v_ref
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
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
    amount, method, status, iso_currency_code, external_reference
  ) VALUES (
    p_group_id, p_payer_member_id, p_receiver_member_id,
    v_insert_amount,
    'stripe',
    'completed',
    upper(trim(coalesce(p_currency, 'USD'))),
    v_ref
  )
  ON CONFLICT (external_reference) WHERE external_reference IS NOT NULL AND external_reference <> ''
  DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT to_jsonb(s) || jsonb_build_object('already_exists', true)
      INTO v_existing
    FROM settlements s
    WHERE s.external_reference = v_ref
    LIMIT 1;

    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;

    RETURN jsonb_build_object('error', 'Could not record settlement');
  END IF;

  SELECT to_jsonb(s) INTO v_settlement
    FROM settlements s WHERE s.id = v_id;

  RETURN v_settlement;
END;
$$;
