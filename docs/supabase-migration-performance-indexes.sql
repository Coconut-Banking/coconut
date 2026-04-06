-- Performance indexes for hot query paths
-- Run in Supabase SQL Editor. All are CREATE IF NOT EXISTS — safe to re-run.

-- group_members: getAccessibleGroupIds queries by user_id
CREATE INDEX IF NOT EXISTS idx_group_members_user_id
  ON group_members (user_id);

-- group_members: composite for access checks (group_id + user_id)
CREATE INDEX IF NOT EXISTS idx_group_members_group_user
  ON group_members (group_id, user_id);

-- group_members: linkMemberByEmail scans by email where user_id IS NULL
CREATE INDEX IF NOT EXISTS idx_group_members_email_null
  ON group_members (email)
  WHERE user_id IS NULL;

-- split_shares: lookup by member_id
CREATE INDEX IF NOT EXISTS idx_split_shares_member_id
  ON split_shares (member_id);

-- split_shares: lookup by split_transaction_id
CREATE INDEX IF NOT EXISTS idx_split_shares_split_tx
  ON split_shares (split_transaction_id);

-- split_transactions: lookup by transaction_id
CREATE INDEX IF NOT EXISTS idx_split_transactions_tx_id
  ON split_transactions (transaction_id);

-- settlements: group + status composite for completed settlement queries
CREATE INDEX IF NOT EXISTS idx_settlements_group_status
  ON settlements (group_id, status);

-- transactions: user + date for transaction listing queries
CREATE INDEX IF NOT EXISTS idx_transactions_user_date
  ON transactions (clerk_user_id, date);
