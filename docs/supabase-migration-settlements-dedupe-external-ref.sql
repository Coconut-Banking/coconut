-- One-off: preview duplicate external_reference rows before applying
-- supabase/migrations/20260601_settlements_external_reference_unique.sql
--
-- Run in Supabase SQL editor if the unique index migration failed with 23505.

-- How many duplicates exist?
SELECT external_reference, COUNT(*) AS cnt
FROM settlements
WHERE external_reference IS NOT NULL AND TRIM(external_reference) <> ''
GROUP BY external_reference
HAVING COUNT(*) > 1
ORDER BY cnt DESC;

-- Rows that would be deleted (keeps earliest created_at per key)
WITH ranked AS (
  SELECT
    id,
    external_reference,
    amount,
    group_id,
    created_at,
    ROW_NUMBER() OVER (
      PARTITION BY external_reference
      ORDER BY created_at ASC NULLS LAST, id ASC
    ) AS rn
  FROM settlements
  WHERE external_reference IS NOT NULL
    AND TRIM(external_reference) <> ''
)
SELECT * FROM ranked WHERE rn > 1 ORDER BY external_reference, created_at;
