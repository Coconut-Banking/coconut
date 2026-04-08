-- Performance indexes v9: group_members email, push_tokens, settlements members,
-- receipt_scans, split_transactions date, plaid_items, transactions plaid_tx_id

-- group_members: email lookup in linkMemberByEmail (runs on every authenticated request)
CREATE INDEX CONCURRENTLY IF NOT EXISTS group_members_email_idx
  ON group_members (email)
  WHERE user_id IS NULL;

-- push_tokens: clerk_user_id lookup in notifyGroupMembers
CREATE INDEX CONCURRENTLY IF NOT EXISTS push_tokens_clerk_user_idx
  ON push_tokens (clerk_user_id);

-- settlements: payer/receiver member lookups (offboard-user, per-member balance queries)
CREATE INDEX CONCURRENTLY IF NOT EXISTS settlements_payer_member_idx
  ON settlements (payer_member_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS settlements_receiver_member_idx
  ON settlements (receiver_member_id);

-- split_transactions: date ordering for recent-activity feed (group_id + date DESC)
CREATE INDEX CONCURRENTLY IF NOT EXISTS split_transactions_group_date_idx
  ON split_transactions (group_id, date DESC)
  WHERE date IS NOT NULL;

-- plaid_items: clerk_user_id lookup (plaid/status, disconnect, sync)
CREATE INDEX CONCURRENTLY IF NOT EXISTS plaid_items_clerk_user_idx
  ON plaid_items (clerk_user_id);

-- transactions: plaid_transaction_id lookup (plaid sync duplicate check)
CREATE INDEX CONCURRENTLY IF NOT EXISTS transactions_plaid_tx_id_idx
  ON transactions (plaid_transaction_id)
  WHERE plaid_transaction_id IS NOT NULL;

-- receipt_scans: clerk_user_id lookup (receipt list + parse routes)
CREATE INDEX CONCURRENTLY IF NOT EXISTS receipt_scans_clerk_user_idx
  ON receipt_scans (clerk_user_id);

-- receipt_items: receipt_id lookup (receipt items + assign routes)
CREATE INDEX CONCURRENTLY IF NOT EXISTS receipt_items_receipt_id_idx
  ON receipt_items (receipt_id);

-- groups: owner_id lookup (getAccessibleGroupIds fallback, canAccessGroup)
CREATE INDEX CONCURRENTLY IF NOT EXISTS groups_owner_id_idx
  ON groups (owner_id);
