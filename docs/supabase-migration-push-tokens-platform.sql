-- Add platform column to push_tokens table
-- Tracks whether the token came from iOS or Android
ALTER TABLE push_tokens
  ADD COLUMN IF NOT EXISTS platform text;
