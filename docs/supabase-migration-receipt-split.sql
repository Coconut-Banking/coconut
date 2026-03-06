-- ============================================================
-- Receipt Split — Migration
-- Run this in the Supabase SQL Editor
-- ============================================================

-- 1. Receipt scans (one per uploaded receipt)
create table if not exists receipt_scans (
  id              uuid primary key default gen_random_uuid(),
  clerk_user_id   text not null,
  group_id        uuid references groups(id) on delete set null,
  merchant_name   text,
  receipt_date    date,
  subtotal        numeric(14,2) not null default 0,
  tax             numeric(14,2) not null default 0,
  tip             numeric(14,2) not null default 0,
  total           numeric(14,2) not null default 0,
  image_base64    text,
  status          text not null default 'parsed',  -- parsed | assigned | settled
  created_at      timestamptz default now()
);
create index if not exists receipt_scans_user_idx on receipt_scans(clerk_user_id);
create index if not exists receipt_scans_group_idx on receipt_scans(group_id);

-- 2. Receipt items (line items extracted from OCR)
create table if not exists receipt_items (
  id            uuid primary key default gen_random_uuid(),
  receipt_id    uuid not null references receipt_scans(id) on delete cascade,
  name          text not null,
  quantity      numeric(10,2) not null default 1,
  unit_price    numeric(14,2) not null default 0,
  total_price   numeric(14,2) not null default 0,
  sort_order    int not null default 0,
  created_at    timestamptz default now()
);
create index if not exists receipt_items_receipt_idx on receipt_items(receipt_id);

-- 3. Receipt assignments (item → person mapping)
create table if not exists receipt_assignments (
  id              uuid primary key default gen_random_uuid(),
  receipt_item_id uuid not null references receipt_items(id) on delete cascade,
  assignee_name   text not null,
  member_id       uuid references group_members(id) on delete set null,
  created_at      timestamptz default now()
);
create index if not exists receipt_assignments_item_idx on receipt_assignments(receipt_item_id);

-- 4. RLS
alter table receipt_scans      enable row level security;
alter table receipt_items       enable row level security;
alter table receipt_assignments enable row level security;
