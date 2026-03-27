-- Add nickname column to accounts table for user-defined account names
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS nickname TEXT;
