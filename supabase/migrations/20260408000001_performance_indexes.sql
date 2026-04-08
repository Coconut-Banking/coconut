-- Performance indexes for Coconut App
-- These indexes correspond to the most common query patterns identified in the API routes.

-- transactions: composite index for per-user queries sorted by date (most used query in the app)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_user_date
  ON transactions (clerk_user_id, date DESC, id DESC);

-- transactions: index for pending filter used in dedup logic
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_user_pending
  ON transactions (clerk_user_id, is_pending);

-- split_transactions: composite index for group-based queries sorted by date
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_split_transactions_group_date
  ON split_transactions (group_id, created_at DESC);

-- split_shares: index for batch lookups by split_transaction_id
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_split_shares_split_id
  ON split_shares (split_transaction_id);

-- settlements: composite index for group+status queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_settlements_group_status
  ON settlements (group_id, status);

-- group_members: index for user_id lookups (used in getAccessibleGroupIds)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_group_members_user_id
  ON group_members (user_id);

-- group_members: index for group_id lookups (used in all group routes)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_group_members_group_id
  ON group_members (group_id);

-- group_members: partial index for email lookups where user is not yet linked
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_group_members_email_unlinked
  ON group_members (email) WHERE user_id IS NULL;

-- plaid_items: index for user-based lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_plaid_items_user_id
  ON plaid_items (clerk_user_id);

-- splitwise_tokens: index for user-based lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_splitwise_tokens_user_id
  ON splitwise_tokens (clerk_user_id);

-- subscriptions: composite index for user+status queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscriptions_user_status
  ON subscriptions (clerk_user_id, status);
