-- Performance indexes v6: Stripe, Splitwise, split-transaction and job queue hot paths
-- Run in Supabase SQL editor. All use CONCURRENTLY to avoid locking.

-- Stripe Connected Account lookups: connect/status, create-account, receiver-status, create-payment-intent
CREATE INDEX CONCURRENTLY IF NOT EXISTS stripe_connected_accounts_clerk_user_idx
  ON stripe_connected_accounts (clerk_user_id);

-- Splitwise token lookups: splitwise/status, splitwise/official-balances, splitwise/import
CREATE INDEX CONCURRENTLY IF NOT EXISTS splitwise_tokens_clerk_user_idx
  ON splitwise_tokens (clerk_user_id);

-- Split-transaction duplicate check: WHERE group_id = ? AND transaction_id = ?
CREATE INDEX CONCURRENTLY IF NOT EXISTS split_transactions_group_tx_idx
  ON split_transactions (group_id, transaction_id);

-- Job queue type+status filter: background sync workers, reauth checks
CREATE INDEX CONCURRENTLY IF NOT EXISTS job_queue_type_status_idx
  ON job_queue (type, status)
  WHERE status IN ('pending', 'processing');

-- Subscriptions active lookup: chat context, insights, subscription detect
CREATE INDEX CONCURRENTLY IF NOT EXISTS subscriptions_user_status_idx
  ON subscriptions (clerk_user_id, status)
  WHERE status = 'active';

-- Gmail scan log: receipt parser skip-duplicates check (clerk_user_id, gmail_message_id)
CREATE INDEX CONCURRENTLY IF NOT EXISTS gmail_scan_log_user_msg_idx
  ON gmail_scan_log (clerk_user_id, gmail_message_id);

-- Accounts table: user account listing for Plaid accounts route
CREATE INDEX CONCURRENTLY IF NOT EXISTS accounts_clerk_user_idx
  ON accounts (clerk_user_id);
