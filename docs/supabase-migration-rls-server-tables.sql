-- ============================================================
-- RLS for server-only tables (Security Advisor: "RLS Disabled in Public")
-- Run in Supabase SQL Editor if you apply migrations manually.
--
-- Safe: Coconut API routes use service_role (getSupabaseAdmin), which bypasses RLS.
-- Effect: blocks direct PostgREST access via the public anon key.
-- ============================================================

ALTER TABLE job_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE card_tool_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE gmail_scan_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_transactions ENABLE ROW LEVEL SECURITY;

-- Intentionally no policies on these tables — default deny for anon/authenticated.
