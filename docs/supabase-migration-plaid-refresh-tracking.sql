-- Track when each Plaid Item was last refreshed (transactionsRefresh call).
-- Used to avoid paying $0.12/call on every pull-to-refresh.
ALTER TABLE plaid_items ADD COLUMN IF NOT EXISTS last_refreshed_at timestamptz;
ALTER TABLE plaid_items ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;
