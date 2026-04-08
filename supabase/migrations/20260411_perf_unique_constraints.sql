-- Only run if not already exists — check first with \d split_transactions

-- Prevent duplicate splits for the same transaction in the same group
-- This allows the API to rely on DB constraint instead of a pre-insert SELECT
ALTER TABLE split_transactions
  ADD CONSTRAINT split_transactions_group_tx_unique
  UNIQUE (group_id, transaction_id)
  DEFERRABLE INITIALLY DEFERRED;
