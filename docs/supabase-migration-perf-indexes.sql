-- Performance indexes for hot query paths (groups/summary, plaid/status, group-access)
-- Run in Supabase SQL Editor. All are CREATE IF NOT EXISTS — safe to re-run.

-- group_members: linkMemberByEmail scans by email + null user_id on every getAccessibleGroupIds
CREATE INDEX IF NOT EXISTS idx_group_members_email_null_user
  ON group_members (email)
  WHERE user_id IS NULL;

-- group_members: getAccessibleGroupIds queries by user_id
CREATE INDEX IF NOT EXISTS idx_group_members_user_id
  ON group_members (user_id)
  WHERE user_id IS NOT NULL;

-- group_members: summary route loads all members for a set of group_ids
CREATE INDEX IF NOT EXISTS idx_group_members_group_id
  ON group_members (group_id);

-- split_transactions: summary route loads up to 25k rows by group_id, ordered by created_at
CREATE INDEX IF NOT EXISTS idx_split_transactions_group_created
  ON split_transactions (group_id, created_at DESC);

-- split_shares: summary route loads all shares for a set of split_transaction_ids
CREATE INDEX IF NOT EXISTS idx_split_shares_split_tx_id
  ON split_shares (split_transaction_id);

-- settlements: summary route loads completed settlements by group_id
CREATE INDEX IF NOT EXISTS idx_settlements_group_status
  ON settlements (group_id)
  WHERE status = 'completed';

-- groups: getAccessibleGroupIds queries owned groups by owner_id
CREATE INDEX IF NOT EXISTS idx_groups_owner_id
  ON groups (owner_id);

-- plaid_items: plaid/status checks linked status by clerk_user_id
CREATE INDEX IF NOT EXISTS idx_plaid_items_clerk_user_id
  ON plaid_items (clerk_user_id);

-- transactions: summary route joins by transaction id to get clerk_user_id
CREATE INDEX IF NOT EXISTS idx_transactions_id_clerk_user
  ON transactions (id, clerk_user_id);
