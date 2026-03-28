-- Add extra Splitwise expense detail columns to split_transactions.
-- Run this in Supabase SQL Editor.

ALTER TABLE split_transactions
  ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS category TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS receipt_url TEXT DEFAULT NULL;
