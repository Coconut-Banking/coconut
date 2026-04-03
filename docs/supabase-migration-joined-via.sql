ALTER TABLE group_members
ADD COLUMN IF NOT EXISTS joined_via text DEFAULT 'added_by_owner';

COMMENT ON COLUMN group_members.joined_via IS 'How member joined: added_by_owner, invite_link, splitwise_import';
