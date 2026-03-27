-- Archive groups (Splitwise-style: hide from main lists, keep history).
alter table groups add column if not exists archived_at timestamptz;

create index if not exists groups_archived_at_idx on groups(archived_at) where archived_at is not null;

comment on column groups.archived_at is 'When set, group is hidden from default lists/summary; owner can unarchive.';
