-- ============================================================
-- Receipt — Other Fees (delivery, service charge, surcharge, etc.)
-- Run AFTER supabase-migration-receipt-split.sql in Supabase SQL Editor
-- ============================================================
alter table receipt_scans add column if not exists other_fees jsonb default '[]';
