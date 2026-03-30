-- Add cached per-group balances to splitwise_tokens (from Splitwise simplified_debts).
-- Run this in Supabase SQL Editor.
ALTER TABLE splitwise_tokens
ADD COLUMN IF NOT EXISTS cached_group_balances JSONB DEFAULT NULL;
