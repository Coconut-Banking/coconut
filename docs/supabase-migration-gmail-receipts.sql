-- Gmail Receipts Database Migration
-- This migration adds tables for Gmail integration and email receipt parsing

-- Table for storing Gmail OAuth tokens and connection info
create table if not exists gmail_connections (
  id              uuid primary key default gen_random_uuid(),
  clerk_user_id   text not null unique,
  email           text,
  access_token    text not null,
  refresh_token   text not null,
  token_expiry    timestamptz,
  last_scan_at    timestamptz,
  created_at      timestamptz default now()
);
create index if not exists gmail_connections_user_idx on gmail_connections(clerk_user_id);

-- Table for storing parsed email receipts
create table if not exists email_receipts (
  id                uuid primary key default gen_random_uuid(),
  clerk_user_id     text not null,
  gmail_message_id  text not null unique,
  transaction_id    uuid references transactions(id),
  merchant          text,
  amount            decimal(12,2),
  date              date,
  currency          text default 'USD',
  line_items        jsonb,
  raw_subject       text,
  raw_from          text,
  parsed_at         timestamptz default now()
);
create index if not exists email_receipts_user_idx  on email_receipts(clerk_user_id);
create index if not exists email_receipts_tx_idx    on email_receipts(transaction_id);
create index if not exists email_receipts_gmail_idx on email_receipts(gmail_message_id);

-- Enable RLS
alter table gmail_connections enable row level security;
alter table email_receipts    enable row level security;

-- RLS policies for gmail_connections
create policy "Users can view own Gmail connections"
  on gmail_connections for select
  using (auth.jwt() ->> 'sub' = clerk_user_id);

create policy "Users can insert own Gmail connections"
  on gmail_connections for insert
  with check (auth.jwt() ->> 'sub' = clerk_user_id);

create policy "Users can update own Gmail connections"
  on gmail_connections for update
  using (auth.jwt() ->> 'sub' = clerk_user_id);

create policy "Users can delete own Gmail connections"
  on gmail_connections for delete
  using (auth.jwt() ->> 'sub' = clerk_user_id);

-- RLS policies for email_receipts
create policy "Users can view own email receipts"
  on email_receipts for select
  using (auth.jwt() ->> 'sub' = clerk_user_id);

create policy "Users can insert own email receipts"
  on email_receipts for insert
  with check (auth.jwt() ->> 'sub' = clerk_user_id);

create policy "Users can update own email receipts"
  on email_receipts for update
  using (auth.jwt() ->> 'sub' = clerk_user_id);

create policy "Users can delete own email receipts"
  on email_receipts for delete
  using (auth.jwt() ->> 'sub' = clerk_user_id);