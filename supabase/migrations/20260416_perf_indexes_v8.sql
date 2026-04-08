-- Performance indexes v8: plaid_items, manual accounts, p2p, push tokens, recurring expenses
-- Run in Supabase SQL editor. All use CONCURRENTLY to avoid locking.

-- plaid_items: queried by clerk_user_id on every Plaid status/accounts/sync route
CREATE INDEX CONCURRENTLY IF NOT EXISTS plaid_items_clerk_user_idx
  ON plaid_items (clerk_user_id);

-- plaid_items: queried by plaid_item_id for token-to-item mapping
CREATE INDEX CONCURRENTLY IF NOT EXISTS plaid_items_plaid_item_id_idx
  ON plaid_items (plaid_item_id);

-- gmail_connections: queried by clerk_user_id on every Gmail route
CREATE INDEX CONCURRENTLY IF NOT EXISTS gmail_connections_clerk_user_idx
  ON gmail_connections (clerk_user_id);

-- receipt_scans: queried by clerk_user_id on every receipt route
CREATE INDEX CONCURRENTLY IF NOT EXISTS receipt_scans_clerk_user_idx
  ON receipt_scans (clerk_user_id);

-- subscription_transactions: queried by transaction_id for FK lookups and split protection
CREATE INDEX CONCURRENTLY IF NOT EXISTS subscription_transactions_tx_id_idx
  ON subscription_transactions (transaction_id);

-- subscription_transactions: queried by subscription_id for cascade deletes
CREATE INDEX CONCURRENTLY IF NOT EXISTS subscription_transactions_sub_id_idx
  ON subscription_transactions (subscription_id);

-- paypal_connections: queried by clerk_user_id on every PayPal route
CREATE INDEX CONCURRENTLY IF NOT EXISTS paypal_connections_clerk_user_idx
  ON paypal_connections (clerk_user_id);

-- manual_accounts: queried by clerk_user_id for wallet account listing
CREATE INDEX CONCURRENTLY IF NOT EXISTS manual_accounts_clerk_user_idx
  ON manual_accounts (clerk_user_id);

-- p2p_annotations: queried by clerk_user_id and transaction_id
CREATE INDEX CONCURRENTLY IF NOT EXISTS p2p_annotations_clerk_user_idx
  ON p2p_annotations (clerk_user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS p2p_annotations_tx_id_idx
  ON p2p_annotations (transaction_id);

-- push_tokens: queried by clerk_user_id for push notification delivery
CREATE INDEX CONCURRENTLY IF NOT EXISTS push_tokens_clerk_user_idx
  ON push_tokens (clerk_user_id);

-- recurring_expenses: queried by clerk_user_id and is_active for due-date processing
CREATE INDEX CONCURRENTLY IF NOT EXISTS recurring_expenses_clerk_user_active_idx
  ON recurring_expenses (clerk_user_id, is_active);
