-- Performance indexes for receipt matching date range queries (latency pass 3)
CREATE INDEX IF NOT EXISTS transactions_user_date_idx
  ON transactions (clerk_user_id, date DESC);
