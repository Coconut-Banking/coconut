-- Track which OAuth scopes were granted (null = pre-modify-scope, needs reauth)
alter table gmail_connections
  add column if not exists scopes text default null;

-- User preference: auto-archive matched email receipts
alter table gmail_connections
  add column if not exists auto_archive_receipts boolean not null default false;
