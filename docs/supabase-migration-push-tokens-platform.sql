-- Create push_tokens table (if it doesn't exist yet) and add platform column
CREATE TABLE IF NOT EXISTS push_tokens (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  clerk_user_id text NOT NULL,
  token text NOT NULL,
  platform text,
  updated_at timestamptz DEFAULT now(),
  UNIQUE (clerk_user_id, token)
);

-- In case the table already exists but lacks the platform column
ALTER TABLE push_tokens
  ADD COLUMN IF NOT EXISTS platform text;
