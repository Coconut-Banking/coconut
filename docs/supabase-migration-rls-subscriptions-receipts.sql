-- ============================================================
-- RLS: Subscriptions and receipt tables
-- Run AFTER supabase-migration-rls-policies.sql (uses requesting_user_id()).
-- ============================================================

-- Subscriptions: users can only see/manage their own
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "subscriptions_select_own" ON subscriptions;
DROP POLICY IF EXISTS "subscriptions_insert_own" ON subscriptions;
DROP POLICY IF EXISTS "subscriptions_update_own" ON subscriptions;
DROP POLICY IF EXISTS "subscriptions_delete_own" ON subscriptions;

CREATE POLICY "subscriptions_select_own" ON subscriptions
  FOR SELECT USING (clerk_user_id = requesting_user_id());

CREATE POLICY "subscriptions_insert_own" ON subscriptions
  FOR INSERT WITH CHECK (clerk_user_id = requesting_user_id());

CREATE POLICY "subscriptions_update_own" ON subscriptions
  FOR UPDATE USING (clerk_user_id = requesting_user_id());

CREATE POLICY "subscriptions_delete_own" ON subscriptions
  FOR DELETE USING (clerk_user_id = requesting_user_id());

-- Receipt scans: replace permissive policy with user-scoped
DROP POLICY IF EXISTS "receipt_scans_all" ON receipt_scans;

CREATE POLICY "receipt_scans_select_own" ON receipt_scans
  FOR SELECT USING (clerk_user_id = requesting_user_id());
CREATE POLICY "receipt_scans_insert_own" ON receipt_scans
  FOR INSERT WITH CHECK (clerk_user_id = requesting_user_id());
CREATE POLICY "receipt_scans_update_own" ON receipt_scans
  FOR UPDATE USING (clerk_user_id = requesting_user_id());
CREATE POLICY "receipt_scans_delete_own" ON receipt_scans
  FOR DELETE USING (clerk_user_id = requesting_user_id());

-- Receipt items: access via owning receipt_scan
DROP POLICY IF EXISTS "receipt_items_all" ON receipt_items;

CREATE POLICY "receipt_items_select" ON receipt_items
  FOR SELECT USING (
    receipt_id IN (
      SELECT id FROM receipt_scans
      WHERE clerk_user_id = requesting_user_id()
    )
  );
CREATE POLICY "receipt_items_insert" ON receipt_items
  FOR INSERT WITH CHECK (
    receipt_id IN (
      SELECT id FROM receipt_scans
      WHERE clerk_user_id = requesting_user_id()
    )
  );
CREATE POLICY "receipt_items_update" ON receipt_items
  FOR UPDATE USING (
    receipt_id IN (
      SELECT id FROM receipt_scans
      WHERE clerk_user_id = requesting_user_id()
    )
  );
CREATE POLICY "receipt_items_delete" ON receipt_items
  FOR DELETE USING (
    receipt_id IN (
      SELECT id FROM receipt_scans
      WHERE clerk_user_id = requesting_user_id()
    )
  );

-- Receipt assignments: access via receipt_item -> receipt_scan
DROP POLICY IF EXISTS "receipt_assignments_all" ON receipt_assignments;

CREATE POLICY "receipt_assignments_select" ON receipt_assignments
  FOR SELECT USING (
    receipt_item_id IN (
      SELECT ri.id FROM receipt_items ri
      JOIN receipt_scans rs ON rs.id = ri.receipt_id
      WHERE rs.clerk_user_id = requesting_user_id()
    )
  );
CREATE POLICY "receipt_assignments_insert" ON receipt_assignments
  FOR INSERT WITH CHECK (
    receipt_item_id IN (
      SELECT ri.id FROM receipt_items ri
      JOIN receipt_scans rs ON rs.id = ri.receipt_id
      WHERE rs.clerk_user_id = requesting_user_id()
    )
  );
CREATE POLICY "receipt_assignments_update" ON receipt_assignments
  FOR UPDATE USING (
    receipt_item_id IN (
      SELECT ri.id FROM receipt_items ri
      JOIN receipt_scans rs ON rs.id = ri.receipt_id
      WHERE rs.clerk_user_id = requesting_user_id()
    )
  );
CREATE POLICY "receipt_assignments_delete" ON receipt_assignments
  FOR DELETE USING (
    receipt_item_id IN (
      SELECT ri.id FROM receipt_items ri
      JOIN receipt_scans rs ON rs.id = ri.receipt_id
      WHERE rs.clerk_user_id = requesting_user_id()
    )
  );
