-- ============================================================
-- Supabase Realtime — Verify RLS is enabled on group tables
-- These are idempotent (safe to re-run). Required for Realtime
-- postgres_changes to scope events per authenticated user.
-- ============================================================

-- The base schema (supabase-schema.sql) already enables RLS on these tables,
-- and supabase-migration-rls-policies.sql defines the SELECT policies.
-- This migration is a safety net to ensure RLS is active.

ALTER TABLE groups              ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members       ENABLE ROW LEVEL SECURITY;
ALTER TABLE split_transactions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE split_shares        ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlements         ENABLE ROW LEVEL SECURITY;

-- Verify the supabase_realtime publication includes these tables.
-- Supabase Realtime requires tables to be in this publication.
-- If the SSE endpoint (/api/groups/[id]/listen) works, this is already set up.
-- If not, uncomment and run:
--
-- ALTER PUBLICATION supabase_realtime ADD TABLE split_transactions;
-- ALTER PUBLICATION supabase_realtime ADD TABLE settlements;
-- ALTER PUBLICATION supabase_realtime ADD TABLE group_members;
