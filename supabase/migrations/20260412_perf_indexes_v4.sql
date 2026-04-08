-- Performance indexes v4: covering indexes for hot query paths
-- Run in Supabase SQL editor. All use CONCURRENTLY to avoid locking.

-- Composite index on split_shares for batch member lookups
-- Speeds up: split_shares queries IN (split_transaction_ids) in recent-activity, summary, person routes
CREATE INDEX CONCURRENTLY IF NOT EXISTS split_shares_split_member_idx
  ON split_shares (split_transaction_id, member_id)
  WHERE split_transaction_id IS NOT NULL AND member_id IS NOT NULL;

-- Covering index for transaction owner lookups by id
-- Speeds up: transactions WHERE id IN (...) fetching clerk_user_id
CREATE INDEX CONCURRENTLY IF NOT EXISTS transactions_id_owner_idx
  ON transactions (id, clerk_user_id);

-- Index for email-based group member matching
-- Speeds up: group_members WHERE email = ? AND group_id = ? (person detail endpoint)
CREATE INDEX CONCURRENTLY IF NOT EXISTS group_members_email_group_idx
  ON group_members (email, group_id)
  WHERE email IS NOT NULL;
