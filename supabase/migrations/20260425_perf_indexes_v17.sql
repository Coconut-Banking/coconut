-- Performance indexes v17: groups invite_token lookup + groups owner index

-- groups: invite_token lookup for invite landing page and join flow
-- GET /api/invite/[token]: WHERE invite_token = ? (table scan without this index)
-- POST /api/invite/[token]/join: same lookup pattern
-- invite_token is unique per group; UNIQUE index also enforces uniqueness constraint.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS groups_invite_token_idx
  ON groups (invite_token)
  WHERE invite_token IS NOT NULL;

-- groups: owner_id for user's own groups listing
-- GET /api/groups: WHERE owner_id = ? OR EXISTS(group_members WHERE user_id = ?)
-- GET /api/groups/uninvited: WHERE owner_id = ?
-- Note: v11 adds (owner_id, source) composite. This pure owner_id index is more
-- selective for queries that don't filter by source.
CREATE INDEX CONCURRENTLY IF NOT EXISTS groups_owner_id_idx
  ON groups (owner_id);
