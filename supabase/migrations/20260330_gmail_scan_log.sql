-- Gmail scan log: tracks every email considered during receipt scanning.
-- Prevents re-processing non-receipts, errors, etc. on subsequent scans.
-- Without this table, every scan re-runs all ~200 emails through OpenAI.

CREATE TABLE IF NOT EXISTS gmail_scan_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id    TEXT NOT NULL,
  gmail_message_id TEXT NOT NULL,
  subject          TEXT DEFAULT '',
  from_address     TEXT DEFAULT '',
  status           TEXT NOT NULL CHECK (status IN ('parsed', 'not_receipt', 'no_body', 'parse_error', 'insert_error')),
  error_reason     TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (clerk_user_id, gmail_message_id)
);

CREATE INDEX IF NOT EXISTS idx_gmail_scan_log_user   ON gmail_scan_log (clerk_user_id);
CREATE INDEX IF NOT EXISTS idx_gmail_scan_log_status ON gmail_scan_log (clerk_user_id, status);

-- Enable RLS (service role used by backend bypasses this, but adds defence-in-depth)
ALTER TABLE gmail_scan_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own scan log"
  ON gmail_scan_log FOR SELECT
  USING (auth.jwt() ->> 'sub' = clerk_user_id);
