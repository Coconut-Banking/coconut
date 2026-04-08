-- Performance indexes v5: receipt, notification, and connection hot paths
-- Run in Supabase SQL editor. All use CONCURRENTLY to avoid locking.

-- Push token lookups: fired on every group action notification (notifyGroupMembers)
CREATE INDEX CONCURRENTLY IF NOT EXISTS push_tokens_clerk_user_idx
  ON push_tokens (clerk_user_id);

-- Receipt item queries: receipt editing, assignment, and finishing workflows
CREATE INDEX CONCURRENTLY IF NOT EXISTS receipt_items_receipt_id_idx
  ON receipt_items (receipt_id);

-- Receipt assignment queries: finish receipt + assign item operations
CREATE INDEX CONCURRENTLY IF NOT EXISTS receipt_assignments_item_id_idx
  ON receipt_assignments (receipt_item_id);

-- PayPal connection lookups: sync cron + on-demand sync
CREATE INDEX CONCURRENTLY IF NOT EXISTS paypal_connections_clerk_user_idx
  ON paypal_connections (clerk_user_id);

-- Gmail connection lookups: email scan cron + on-demand scan
CREATE INDEX CONCURRENTLY IF NOT EXISTS gmail_connections_clerk_user_idx
  ON gmail_connections (clerk_user_id);
