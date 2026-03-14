-- Add price change tracking and confidence columns to subscriptions
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS previous_amount NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS price_change_amount NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS price_change_detected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confidence NUMERIC(3,2);
