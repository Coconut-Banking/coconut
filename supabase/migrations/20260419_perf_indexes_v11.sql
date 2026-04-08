-- Performance indexes v11: composite indexes for multi-column WHERE clauses

-- groups: (owner_id, source) composite for Splitwise status count query
-- WHERE owner_id = ? AND source = 'splitwise'
CREATE INDEX CONCURRENTLY IF NOT EXISTS groups_owner_source_idx
  ON groups (owner_id, source)
  WHERE source IS NOT NULL;

-- split_shares: (split_transaction_id, member_id) composite for balance lookups
-- Allows index-only scan when fetching (split_transaction_id, member_id, amount)
CREATE INDEX CONCURRENTLY IF NOT EXISTS split_shares_tx_member_idx
  ON split_shares (split_transaction_id, member_id);

-- group_members: (group_id, display_name) for sorted member listings
CREATE INDEX CONCURRENTLY IF NOT EXISTS group_members_group_name_idx
  ON group_members (group_id, display_name);

-- transactions: (clerk_user_id, is_pending) for pending transaction filters
CREATE INDEX CONCURRENTLY IF NOT EXISTS transactions_user_pending_idx
  ON transactions (clerk_user_id, is_pending)
  WHERE is_pending = true;

-- settlements: (group_id, created_at DESC) for recent settlement queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS settlements_group_created_idx
  ON settlements (group_id, created_at DESC)
  WHERE status = 'completed';

-- email_receipts: (clerk_user_id, merchant_name) for receipt matching by merchant
CREATE INDEX CONCURRENTLY IF NOT EXISTS email_receipts_user_merchant_idx
  ON email_receipts (clerk_user_id, merchant_name)
  WHERE merchant_name IS NOT NULL;
