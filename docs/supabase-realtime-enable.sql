-- Enable Realtime for shared expense tables.
-- Run in Supabase SQL Editor: Dashboard → SQL Editor
-- (or use Dashboard → Database → Replication → supabase_realtime).
-- If tables are already in the publication, you'll get an error — that's fine.

alter publication supabase_realtime add table split_transactions;
alter publication supabase_realtime add table settlements;
alter publication supabase_realtime add table group_members;
