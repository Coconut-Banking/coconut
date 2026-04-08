-- Performance indexes v16: recurring_expenses, manual_accounts, subscriptions sort, paypal_connections

-- recurring_expenses: active schedule lookups
-- GET /api/recurring-expenses: WHERE clerk_user_id = ? AND is_active = true ORDER BY next_due_date ASC
-- lib/recurring-expenses.ts processRecurringExpenses: WHERE clerk_user_id = ? AND is_active = true AND next_due_date <= today
-- Partial index on is_active=true covers both queries; next_due_date enables index-order scan.
CREATE INDEX CONCURRENTLY IF NOT EXISTS recurring_expenses_user_active_due_idx
  ON recurring_expenses (clerk_user_id, next_due_date ASC)
  WHERE is_active = true;

-- manual_accounts: user listing ordered by created_at
-- GET /api/manual-accounts: WHERE clerk_user_id = ? ORDER BY created_at ASC
-- GET /api/dashboard: same pattern via Promise.all
CREATE INDEX CONCURRENTLY IF NOT EXISTS manual_accounts_user_created_idx
  ON manual_accounts (clerk_user_id, created_at ASC);

-- subscriptions: sort by next_due_date for dashboard and API
-- GET /api/dashboard and GET /api/subscriptions both ORDER BY next_due_date ASC
-- v6 subscriptions_user_status_idx covers (clerk_user_id, status) but lacks next_due_date,
-- forcing a sort-after-filter. This covering index enables index-order retrieval.
CREATE INDEX CONCURRENTLY IF NOT EXISTS subscriptions_user_status_due_idx
  ON subscriptions (clerk_user_id, next_due_date ASC)
  WHERE status = 'active';

-- paypal_connections: per-user status lookup
-- lib/paypal-auth.ts getPayPalStatus: WHERE clerk_user_id = ?
-- GET /api/paypal/status calls this on every status check
CREATE INDEX CONCURRENTLY IF NOT EXISTS paypal_connections_clerk_user_idx
  ON paypal_connections (clerk_user_id);
