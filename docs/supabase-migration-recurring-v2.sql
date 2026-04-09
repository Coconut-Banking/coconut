-- ============================================================
-- Recurring Expenses v2 — end conditions + custom intervals
-- Run in Supabase SQL Editor
-- ============================================================

ALTER TABLE recurring_expenses ADD COLUMN IF NOT EXISTS end_date date;
ALTER TABLE recurring_expenses ADD COLUMN IF NOT EXISTS max_occurrences int;
ALTER TABLE recurring_expenses ADD COLUMN IF NOT EXISTS occurrences_created int DEFAULT 0;
ALTER TABLE recurring_expenses ADD COLUMN IF NOT EXISTS custom_interval_days int;

-- Allow 'custom' as a frequency value
ALTER TABLE recurring_expenses DROP CONSTRAINT IF EXISTS recurring_expenses_frequency_check;
ALTER TABLE recurring_expenses ADD CONSTRAINT recurring_expenses_frequency_check
  CHECK (frequency IN ('weekly', 'biweekly', 'monthly', 'custom'));
