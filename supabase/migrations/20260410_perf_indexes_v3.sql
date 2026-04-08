-- Index for email receipt lookup by matched transaction (used in chat + receipt-matcher)
CREATE INDEX CONCURRENTLY IF NOT EXISTS email_receipts_matched_tx_idx
  ON email_receipts (clerk_user_id, transaction_id)
  WHERE transaction_id IS NOT NULL;

-- Index for settlements lookup by group + status (already exists as partial in v2, verify)
CREATE INDEX CONCURRENTLY IF NOT EXISTS settlements_group_completed_idx
  ON settlements (group_id, payer_member_id, receiver_member_id)
  WHERE status = 'completed';

-- Index for split_transactions lookup — support DESC order by created_at per group
CREATE INDEX CONCURRENTLY IF NOT EXISTS split_tx_group_created_desc_idx
  ON split_transactions (group_id, created_at DESC)
  WHERE group_id IS NOT NULL;
