-- Gmail 2-in-1: Add email_scan_enabled preference column
-- Allows users to opt in/out of Gmail receipt scanning without a separate OAuth flow.

ALTER TABLE gmail_connections
  ADD COLUMN IF NOT EXISTS email_scan_enabled boolean DEFAULT false;

-- Existing connected users (with stored tokens) should keep scanning enabled
UPDATE gmail_connections SET email_scan_enabled = true
  WHERE access_token IS NOT NULL AND access_token != '';
