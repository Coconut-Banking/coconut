-- ============================================================
-- Coconut — RLS Policies Migration
-- Run this in the Supabase SQL Editor AFTER the base schema.
--
-- These policies restrict row access by clerk_user_id.
-- The service role key (used by getSupabaseAdmin) bypasses RLS,
-- so these are defense-in-depth for when a user-scoped client
-- (anon key + Clerk JWT) is adopted in the future.
--
-- To use Clerk JWTs with Supabase, set the JWT secret in
-- Supabase auth settings and extract the sub claim via:
--   auth.jwt()->>'sub'
-- Until then, these policies use current_setting('request.jwt.claims')
-- which Supabase populates automatically from the Authorization header.
-- ============================================================

-- Helper: extract clerk_user_id from JWT claims
CREATE OR REPLACE FUNCTION requesting_user_id() RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT coalesce(
    current_setting('request.jwt.claims', true)::json->>'sub',
    ''
  );
$$;

-- ============================================================
-- plaid_items: users can only see/manage their own bank connections
-- ============================================================
CREATE POLICY "plaid_items_select_own" ON plaid_items
  FOR SELECT USING (clerk_user_id = requesting_user_id());

CREATE POLICY "plaid_items_insert_own" ON plaid_items
  FOR INSERT WITH CHECK (clerk_user_id = requesting_user_id());

CREATE POLICY "plaid_items_update_own" ON plaid_items
  FOR UPDATE USING (clerk_user_id = requesting_user_id());

CREATE POLICY "plaid_items_delete_own" ON plaid_items
  FOR DELETE USING (clerk_user_id = requesting_user_id());

-- ============================================================
-- accounts: users can only see/manage their own accounts
-- ============================================================
CREATE POLICY "accounts_select_own" ON accounts
  FOR SELECT USING (clerk_user_id = requesting_user_id());

CREATE POLICY "accounts_insert_own" ON accounts
  FOR INSERT WITH CHECK (clerk_user_id = requesting_user_id());

CREATE POLICY "accounts_update_own" ON accounts
  FOR UPDATE USING (clerk_user_id = requesting_user_id());

CREATE POLICY "accounts_delete_own" ON accounts
  FOR DELETE USING (clerk_user_id = requesting_user_id());

-- ============================================================
-- transactions: users can only see/manage their own transactions
-- ============================================================
CREATE POLICY "transactions_select_own" ON transactions
  FOR SELECT USING (clerk_user_id = requesting_user_id());

CREATE POLICY "transactions_insert_own" ON transactions
  FOR INSERT WITH CHECK (clerk_user_id = requesting_user_id());

CREATE POLICY "transactions_update_own" ON transactions
  FOR UPDATE USING (clerk_user_id = requesting_user_id());

CREATE POLICY "transactions_delete_own" ON transactions
  FOR DELETE USING (clerk_user_id = requesting_user_id());

-- ============================================================
-- groups: owners can manage, members can read via group_members
-- ============================================================
CREATE POLICY "groups_select_member" ON groups
  FOR SELECT USING (
    owner_id = requesting_user_id()
    OR id IN (
      SELECT group_id FROM group_members
      WHERE user_id = requesting_user_id()
    )
  );

CREATE POLICY "groups_insert_owner" ON groups
  FOR INSERT WITH CHECK (owner_id = requesting_user_id());

CREATE POLICY "groups_update_owner" ON groups
  FOR UPDATE USING (owner_id = requesting_user_id());

CREATE POLICY "groups_delete_owner" ON groups
  FOR DELETE USING (owner_id = requesting_user_id());

-- ============================================================
-- group_members: visible to anyone in the same group
-- ============================================================
CREATE POLICY "group_members_select" ON group_members
  FOR SELECT USING (
    group_id IN (
      SELECT group_id FROM group_members
      WHERE user_id = requesting_user_id()
    )
    OR group_id IN (
      SELECT id FROM groups
      WHERE owner_id = requesting_user_id()
    )
  );

CREATE POLICY "group_members_insert_owner" ON group_members
  FOR INSERT WITH CHECK (
    group_id IN (
      SELECT id FROM groups
      WHERE owner_id = requesting_user_id()
    )
  );

CREATE POLICY "group_members_delete_owner" ON group_members
  FOR DELETE USING (
    group_id IN (
      SELECT id FROM groups
      WHERE owner_id = requesting_user_id()
    )
  );

-- ============================================================
-- split_transactions: visible to group members
-- ============================================================
CREATE POLICY "split_transactions_select" ON split_transactions
  FOR SELECT USING (
    group_id IN (
      SELECT group_id FROM group_members
      WHERE user_id = requesting_user_id()
    )
    OR group_id IN (
      SELECT id FROM groups
      WHERE owner_id = requesting_user_id()
    )
  );

CREATE POLICY "split_transactions_insert" ON split_transactions
  FOR INSERT WITH CHECK (created_by = requesting_user_id());

CREATE POLICY "split_transactions_delete_creator" ON split_transactions
  FOR DELETE USING (
    created_by = requesting_user_id()
    OR group_id IN (
      SELECT id FROM groups
      WHERE owner_id = requesting_user_id()
    )
  );

-- ============================================================
-- split_shares: visible to group members (via split_transactions)
-- ============================================================
CREATE POLICY "split_shares_select" ON split_shares
  FOR SELECT USING (
    split_transaction_id IN (
      SELECT id FROM split_transactions
      WHERE group_id IN (
        SELECT group_id FROM group_members
        WHERE user_id = requesting_user_id()
      )
      OR group_id IN (
        SELECT id FROM groups
        WHERE owner_id = requesting_user_id()
      )
    )
  );

CREATE POLICY "split_shares_insert" ON split_shares
  FOR INSERT WITH CHECK (
    split_transaction_id IN (
      SELECT id FROM split_transactions
      WHERE created_by = requesting_user_id()
    )
  );

CREATE POLICY "split_shares_delete" ON split_shares
  FOR DELETE USING (
    split_transaction_id IN (
      SELECT id FROM split_transactions
      WHERE created_by = requesting_user_id()
        OR group_id IN (
          SELECT id FROM groups
          WHERE owner_id = requesting_user_id()
        )
    )
  );

-- ============================================================
-- settlements: visible to group members
-- ============================================================
CREATE POLICY "settlements_select" ON settlements
  FOR SELECT USING (
    group_id IN (
      SELECT group_id FROM group_members
      WHERE user_id = requesting_user_id()
    )
    OR group_id IN (
      SELECT id FROM groups
      WHERE owner_id = requesting_user_id()
    )
  );

CREATE POLICY "settlements_insert" ON settlements
  FOR INSERT WITH CHECK (
    group_id IN (
      SELECT group_id FROM group_members
      WHERE user_id = requesting_user_id()
    )
    OR group_id IN (
      SELECT id FROM groups
      WHERE owner_id = requesting_user_id()
    )
  );

CREATE POLICY "settlements_delete_owner" ON settlements
  FOR DELETE USING (
    group_id IN (
      SELECT id FROM groups
      WHERE owner_id = requesting_user_id()
    )
  );
