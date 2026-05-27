-- Enable RLS on server-internal / admin-only tables exposed to PostgREST.
-- No policies are added: anon and authenticated roles are denied by default.
-- service_role (getSupabaseAdmin) bypasses RLS and continues to work unchanged.

-- Background job queue (Plaid webhook → cron worker)
ALTER TABLE job_queue ENABLE ROW LEVEL SECURITY;

-- Card recommendation tool (sessions may contain Plaid access tokens)
ALTER TABLE card_tool_sessions ENABLE ROW LEVEL SECURITY;

-- Card catalog (read only via API routes today)
ALTER TABLE credit_cards ENABLE ROW LEVEL SECURITY;

-- Push notification device tokens
ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

-- Gmail receipt scan audit log
ALTER TABLE gmail_scan_log ENABLE ROW LEVEL SECURITY;

-- Subscription ↔ bank transaction links (junction table)
ALTER TABLE subscription_transactions ENABLE ROW LEVEL SECURITY;
