-- Idempotent Stripe / Splitwise settlement recording.
-- Step 1: remove duplicate external_reference rows (keeps earliest per key).
-- Step 2: unique index so new duplicates cannot be inserted.

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY external_reference
      ORDER BY created_at ASC NULLS LAST, id ASC
    ) AS rn
  FROM settlements
  WHERE external_reference IS NOT NULL
    AND TRIM(external_reference) <> ''
)
DELETE FROM settlements
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS settlements_external_reference_unique
  ON settlements (external_reference)
  WHERE external_reference IS NOT NULL AND external_reference <> '';
