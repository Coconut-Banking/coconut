-- Prevent duplicate group members with null emails (same group + display name).
-- The existing UNIQUE(group_id, email) doesn't catch NULLs because NULL != NULL in SQL.
CREATE UNIQUE INDEX IF NOT EXISTS group_members_no_email_dedup_idx
  ON group_members(group_id, display_name) WHERE email IS NULL;

-- Also add a unique index scoped to owner for Splitwise groups to prevent races.
-- The existing groups_source_ext_idx is global (source, external_id) which is too broad
-- for multi-tenant — it blocks different users from importing the same Splitwise group.
DROP INDEX IF EXISTS groups_source_ext_idx;
CREATE UNIQUE INDEX IF NOT EXISTS groups_owner_source_ext_idx
  ON groups(owner_id, source, external_id) WHERE external_id IS NOT NULL;
