-- split_shares: hottest query — fetched on every group load
CREATE INDEX IF NOT EXISTS split_shares_split_tx_idx
  ON split_shares (split_transaction_id);

-- split_transactions: group scans in summary + recent-activity
CREATE INDEX IF NOT EXISTS split_transactions_group_created_idx
  ON split_transactions (group_id, created_at DESC);

-- group_members: group_id lookups (summary, recent-activity, people)
CREATE INDEX IF NOT EXISTS group_members_group_id_idx
  ON group_members (group_id);

-- group_members: user_id lookups (canAccessGroup, linkMemberByEmail)
CREATE INDEX IF NOT EXISTS group_members_user_id_idx
  ON group_members (user_id);

-- settlements: balance computation filter
CREATE INDEX IF NOT EXISTS settlements_group_status_idx
  ON settlements (group_id, status)
  WHERE status = 'completed';

-- email_receipts: list query + rematch cron
CREATE INDEX IF NOT EXISTS email_receipts_user_parsed_idx
  ON email_receipts (clerk_user_id, parsed_at DESC);

-- email_receipts: transaction_id FK lookup
CREATE INDEX IF NOT EXISTS email_receipts_tx_id_idx
  ON email_receipts (transaction_id)
  WHERE transaction_id IS NOT NULL;

-- transactions: receipt matching date range queries
CREATE INDEX IF NOT EXISTS transactions_user_date_idx
  ON transactions (clerk_user_id, date DESC);
