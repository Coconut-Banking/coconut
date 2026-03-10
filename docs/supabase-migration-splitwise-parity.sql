-- Splitwise parity: payer, group types, invite links
-- Run in Supabase SQL Editor

alter table groups add column if not exists group_type text default 'other';
alter table groups add column if not exists invite_token text unique;

-- Who actually paid for this split (null = infer from transaction owner)
alter table split_transactions add column if not exists payer_member_id uuid references group_members(id) on delete set null;

create index if not exists split_transactions_payer_idx on split_transactions(payer_member_id) where payer_member_id is not null;
create index if not exists groups_invite_token_idx on groups(invite_token) where invite_token is not null;
