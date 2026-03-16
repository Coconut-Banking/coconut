-- ============================================================
-- Recurring Expenses Migration
-- Auto-repeating split expenses on a schedule
-- Run in Supabase SQL Editor
-- ============================================================

create table if not exists recurring_expenses (
  id              uuid primary key default gen_random_uuid(),
  clerk_user_id   text not null,
  group_id        uuid not null references groups(id) on delete cascade,
  person_key      text,
  amount          numeric(14,2) not null,
  description     text not null,
  frequency       text not null check (frequency in ('weekly', 'biweekly', 'monthly')),
  next_due_date   date not null,
  last_created_at timestamptz,
  is_active       boolean default true,
  created_at      timestamptz default now()
);

create index if not exists recurring_expenses_user_idx on recurring_expenses(clerk_user_id);
create index if not exists recurring_expenses_due_idx on recurring_expenses(next_due_date) where is_active = true;

alter table recurring_expenses enable row level security;
