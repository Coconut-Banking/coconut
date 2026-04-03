-- Add image_url column to groups table for custom group icons
ALTER TABLE groups ADD COLUMN IF NOT EXISTS image_url text;
