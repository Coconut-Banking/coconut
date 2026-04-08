-- Performance indexes v14: job_queue dedup + ordering, and covering indexes

-- job_queue: dedup check in plaid webhook handler
-- WHERE type = 'plaid_sync' AND clerk_user_id = ? AND status IN ('pending', 'processing') LIMIT 1
-- The existing (type, status) index from v6 doesn't include clerk_user_id
CREATE INDEX CONCURRENTLY IF NOT EXISTS job_queue_type_user_status_idx
  ON job_queue (type, clerk_user_id, status)
  WHERE status IN ('pending', 'processing');

-- job_queue: cron ORDER BY created_at within status filter
-- WHERE (status = 'pending' OR ...) ORDER BY created_at ASC LIMIT 5
-- Allows sorted index scan instead of sort-after-filter
CREATE INDEX CONCURRENTLY IF NOT EXISTS job_queue_status_created_idx
  ON job_queue (status, created_at ASC);

-- group_members: covering index for member listing (user_id + group_id + display_name)
-- Queries that SELECT group_id, display_name, user_id WHERE group_id = ?
-- can avoid heap fetch with this covering index
CREATE INDEX CONCURRENTLY IF NOT EXISTS group_members_group_covering_idx
  ON group_members (group_id, display_name, user_id);

-- split_transactions: covering index including description for summary display
-- Extends group+created to include description (used in group summary/feed)
CREATE INDEX CONCURRENTLY IF NOT EXISTS split_transactions_group_created_cover_idx
  ON split_transactions (group_id, created_at DESC, id, description)
  WHERE group_id IS NOT NULL;

-- settlements: covering index for payer+receiver lookup in balance computation
-- SELECT payer_member_id, receiver_member_id, amount WHERE group_id = ? AND status = 'completed'
CREATE INDEX CONCURRENTLY IF NOT EXISTS settlements_group_payer_receiver_idx
  ON settlements (group_id, payer_member_id, receiver_member_id, amount)
  WHERE status = 'completed';
