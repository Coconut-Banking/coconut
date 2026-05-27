-- Run this if 20260528_payment_requests_and_collect.sql failed on user_preferences.
-- Core tables (payment_requests, collect_sessions, etc.) should already exist.

-- Backfill group invite tokens
UPDATE groups
SET invite_token = 'inv_' || replace(gen_random_uuid()::text, '-', '')
WHERE invite_token IS NULL AND archived_at IS NULL;
