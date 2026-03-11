-- Gmail scan log: tracks every email processed during receipt scanning.
-- Enables debugging missed receipts and prevents re-processing non-receipts.
--
-- Run this migration against your Supabase project:
--   psql $DATABASE_URL -f docs/supabase-migration-gmail-scan-log.sql

CREATE TABLE IF NOT EXISTS gmail_scan_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL,
  gmail_message_id TEXT NOT NULL,
  subject TEXT DEFAULT '',
  from_address TEXT DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('parsed', 'not_receipt', 'no_body', 'parse_error', 'insert_error')),
  error_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (clerk_user_id, gmail_message_id)
);

CREATE INDEX IF NOT EXISTS idx_gmail_scan_log_user ON gmail_scan_log (clerk_user_id);
CREATE INDEX IF NOT EXISTS idx_gmail_scan_log_status ON gmail_scan_log (clerk_user_id, status);
