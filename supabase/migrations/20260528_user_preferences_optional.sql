-- Optional — only run when you add opt-in split reminder digests (Phase 5).
-- Safe to skip for now; nothing in production reads this table yet.

CREATE TABLE IF NOT EXISTS user_preferences (
  clerk_user_id text PRIMARY KEY,
  split_reminders_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_preferences_service" ON user_preferences FOR ALL USING (true) WITH CHECK (true);
