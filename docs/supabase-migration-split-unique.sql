-- Run in Supabase SQL Editor to prevent duplicate splits (same tx in same group twice).
-- If you have duplicates, run this first to keep one per group+tx:
--   DELETE FROM split_transactions a USING split_transactions b
--   WHERE a.id > b.id AND a.group_id = b.group_id AND a.transaction_id = b.transaction_id;
-- If constraint already exists: DROP CONSTRAINT split_transactions_group_tx_unique; first.
ALTER TABLE split_transactions
  ADD CONSTRAINT split_transactions_group_tx_unique UNIQUE(group_id, transaction_id);
