-- Performance indexes v10: composite indexes + remaining hot-path tables

-- group_members: composite (group_id, user_id) for canAccessGroup membership check
-- Replaces two separate index scans with one efficient composite lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS group_members_group_user_idx
  ON group_members (group_id, user_id)
  WHERE user_id IS NOT NULL;

-- transactions: account_id filter used by search v2 when filtering by bank account
CREATE INDEX CONCURRENTLY IF NOT EXISTS transactions_account_id_idx
  ON transactions (account_id)
  WHERE account_id IS NOT NULL;

-- receipt_assignments: receipt_item_id lookup (delete + insert in receipt/assign route)
CREATE INDEX CONCURRENTLY IF NOT EXISTS receipt_assignments_item_id_idx
  ON receipt_assignments (receipt_item_id);

-- split_transactions: payer_member_id lookup (group person balance, export, summary)
CREATE INDEX CONCURRENTLY IF NOT EXISTS split_transactions_payer_member_idx
  ON split_transactions (payer_member_id)
  WHERE payer_member_id IS NOT NULL;

-- split_shares: member_id lookup (per-member share queries in balance calculation)
CREATE INDEX CONCURRENTLY IF NOT EXISTS split_shares_member_id_idx
  ON split_shares (member_id);

-- transactions: normalized_merchant for receipt matching + search ilike queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS transactions_normalized_merchant_idx
  ON transactions (normalized_merchant)
  WHERE normalized_merchant IS NOT NULL;

-- email_receipts: status filter for rematch cron (unmatched receipts)
CREATE INDEX CONCURRENTLY IF NOT EXISTS email_receipts_user_unmatched_idx
  ON email_receipts (clerk_user_id, parsed_at DESC)
  WHERE transaction_id IS NULL;

-- group_members: composite (email, user_id) for linkMemberByEmail update
-- After finding by email, update needs user_id IS NULL filter
CREATE INDEX CONCURRENTLY IF NOT EXISTS group_members_email_null_user_idx
  ON group_members (email, id)
  WHERE user_id IS NULL AND email IS NOT NULL;
