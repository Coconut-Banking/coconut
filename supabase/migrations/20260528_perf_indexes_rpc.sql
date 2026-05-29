-- Hot-path indexes + group access RPC (from docs/supabase-migration-perf-v2.sql)

CREATE INDEX IF NOT EXISTS idx_split_tx_transaction_id
  ON split_transactions (transaction_id)
  WHERE transaction_id IS NOT NULL;

CREATE OR REPLACE FUNCTION get_accessible_group_ids(p_user_id text)
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  SELECT id FROM groups WHERE owner_id = p_user_id
  UNION
  SELECT group_id FROM group_members WHERE user_id = p_user_id
$$;
