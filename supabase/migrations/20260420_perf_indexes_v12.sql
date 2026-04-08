-- Performance indexes v12: covering indexes + remaining hot-path gaps

-- email_receipts: date filter for item-insights detectItemTrends
-- WHERE clerk_user_id = ? AND date >= monthStart (uses date, not parsed_at)
CREATE INDEX CONCURRENTLY IF NOT EXISTS email_receipts_user_date_idx
  ON email_receipts (clerk_user_id, date DESC)
  WHERE date IS NOT NULL;

-- transactions: source filter for PayPal disconnect/sync and CSV import
-- WHERE clerk_user_id = ? AND source = 'paypal' / 'plaid'
CREATE INDEX CONCURRENTLY IF NOT EXISTS transactions_user_source_idx
  ON transactions (clerk_user_id, source)
  WHERE source IS NOT NULL;

-- group_members: covering index (user_id, group_id) for getAccessibleGroupIds fallback
-- SELECT group_id WHERE user_id = ? — allows index-only scan without heap fetch
CREATE INDEX CONCURRENTLY IF NOT EXISTS group_members_user_group_idx
  ON group_members (user_id, group_id)
  WHERE user_id IS NOT NULL;

-- accounts: plaid_item_id for enrichAccountsWithInstitution account-by-item lookups
-- WHERE plaid_item_id IN (...)
CREATE INDEX CONCURRENTLY IF NOT EXISTS accounts_plaid_item_id_idx
  ON accounts (plaid_item_id)
  WHERE plaid_item_id IS NOT NULL;

-- split_transactions: owner-level balance summary (group_id, payer_member_id)
-- WHERE group_id = ? GROUP BY payer_member_id — composite avoids separate index scans
CREATE INDEX CONCURRENTLY IF NOT EXISTS split_transactions_group_payer_idx
  ON split_transactions (group_id, payer_member_id)
  WHERE payer_member_id IS NOT NULL;

-- split_shares: amount for covering index on hot balance query
-- Extends split_shares_tx_member_idx to include amount for index-only scans
CREATE INDEX CONCURRENTLY IF NOT EXISTS split_shares_tx_member_amount_idx
  ON split_shares (split_transaction_id, member_id, amount);
