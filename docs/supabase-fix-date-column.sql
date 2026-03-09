-- Check if date column exists, if not add it
ALTER TABLE email_receipts
ADD COLUMN IF NOT EXISTS date date;

-- Update any existing records with parsed_at as the date if date is null
UPDATE email_receipts
SET date = parsed_at::date
WHERE date IS NULL;