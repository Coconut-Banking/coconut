-- Add cached friend balances to splitwise_tokens
-- Run this in Supabase SQL Editor
ALTER TABLE splitwise_tokens
ADD COLUMN IF NOT EXISTS cached_friend_balances JSONB DEFAULT NULL;
