-- Track when a user finished their one-time Splitwise import (re-import is blocked in API).
alter table splitwise_tokens
  add column if not exists import_completed_at timestamptz;

-- Backfill for users who already imported before this column existed.
update splitwise_tokens t
set import_completed_at = sub.earliest
from (
  select g.owner_id as clerk_user_id, min(g.created_at) as earliest
  from groups g
  where g.source = 'splitwise'
  group by g.owner_id
) sub
where t.clerk_user_id = sub.clerk_user_id
  and t.import_completed_at is null;
