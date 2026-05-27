-- payment_requests, collect_sessions, receipt collect participants

CREATE TABLE IF NOT EXISTS collect_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  host_clerk_user_id text NOT NULL,
  session_type text NOT NULL CHECK (session_type IN ('receipt', 'pay')),
  payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'expired')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS collect_sessions_group_idx ON collect_sessions(group_id);

CREATE TABLE IF NOT EXISTS payment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  receipt_scan_id uuid REFERENCES receipt_scans(id) ON DELETE SET NULL,
  collect_session_id uuid REFERENCES collect_sessions(id) ON DELETE SET NULL,
  payer_member_id uuid NOT NULL REFERENCES group_members(id) ON DELETE CASCADE,
  receiver_member_id uuid NOT NULL REFERENCES group_members(id) ON DELETE CASCADE,
  amount numeric(14,2) NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  label text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled', 'settled_off_link')),
  resolution_method text CHECK (resolution_method IN ('stripe', 'add_to_tab', 'manual')),
  pay_link_token text,
  external_reference text,
  created_at timestamptz DEFAULT now(),
  paid_at timestamptz,
  last_nudged_at timestamptz
);

CREATE INDEX IF NOT EXISTS payment_requests_payer_pending_idx
  ON payment_requests(payer_member_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS payment_requests_receiver_pending_idx
  ON payment_requests(receiver_member_id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS receipt_collect_participants (
  collect_session_id uuid NOT NULL REFERENCES collect_sessions(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES group_members(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'claimed', 'submitted')),
  clerk_user_id text,
  submitted_at timestamptz,
  PRIMARY KEY (collect_session_id, member_id)
);

ALTER TABLE receipt_scans
  ADD COLUMN IF NOT EXISTS collect_session_id uuid REFERENCES collect_sessions(id) ON DELETE SET NULL;

ALTER TABLE collect_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_collect_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "collect_sessions_service" ON collect_sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "payment_requests_service" ON payment_requests FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "receipt_collect_participants_service" ON receipt_collect_participants FOR ALL USING (true) WITH CHECK (true);

-- split_reminders_enabled: deferred until user_preferences table exists (see 20260528_user_preferences.sql)

-- Backfill group invite tokens for existing groups
UPDATE groups
SET invite_token = 'inv_' || replace(gen_random_uuid()::text, '-', '')
WHERE invite_token IS NULL;
