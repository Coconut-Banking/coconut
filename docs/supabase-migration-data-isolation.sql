-- Fix data isolation: unique indexes must be per-user, not global.
-- Without this, two users importing the same Splitwise group collide.

-- 1. Drop the global unique index on groups(source, external_id)
--    and replace with a per-owner index.
DROP INDEX IF EXISTS groups_source_ext_idx;
CREATE UNIQUE INDEX groups_source_ext_owner_idx
  ON groups(owner_id, source, external_id)
  WHERE external_id IS NOT NULL;

-- 2. Drop the global unique index on split_transactions(source, external_id)
--    and replace with a per-group index (each user has their own group copy).
DROP INDEX IF EXISTS split_transactions_source_ext_idx;
CREATE UNIQUE INDEX split_transactions_source_ext_group_idx
  ON split_transactions(group_id, source, external_id)
  WHERE external_id IS NOT NULL;
