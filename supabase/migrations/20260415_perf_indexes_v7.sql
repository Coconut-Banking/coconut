-- Performance indexes v7: Plaid, Gmail connections, receipt scans, subscription transactions, PayPal
-- Run in Supabase SQL editor. All use CONCURRENTLY to avoid locking.

-- Plaid item lookups by user: transaction sync, plaid-status, plaid-accounts routes
CREATE INDEX CONCURRENTLY IF NOT EXISTS plaid_items_clerk_user_idx
  ON plaid_items (clerk_user_id);

-- Plaid item lookups by item ID: webhook handler (item/transactions webhooks)
CREATE INDEX CONCURRENTLY IF NOT EXISTS plaid_items_item_id_idx
  ON plaid_items (plaid_item_id);

-- Gmail connection lookups by user: gmail/status, receipt parser auth check
CREATE INDEX CONCURRENTLY IF NOT EXISTS gmail_connections_clerk_user_idx
  ON gmail_connections (clerk_user_id);

-- Receipt scan lookups by user: receipt-scans route, receipt history queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS receipt_scans_clerk_user_idx
  ON receipt_scans (clerk_user_id);

-- Subscription transaction lookups by transaction ID: IN-query joins from transactions
CREATE INDEX CONCURRENTLY IF NOT EXISTS subscription_transactions_tx_idx
  ON subscription_transactions (transaction_id);

-- Subscription transaction lookups by subscription ID: IN-query joins from subscriptions
CREATE INDEX CONCURRENTLY IF NOT EXISTS subscription_transactions_sub_idx
  ON subscription_transactions (subscription_id);

-- PayPal connection lookups by user: paypal/status, paypal/connect routes
CREATE INDEX CONCURRENTLY IF NOT EXISTS paypal_connections_clerk_user_idx
  ON paypal_connections (clerk_user_id);
