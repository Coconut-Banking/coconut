-- Add source tracking and P2P metadata to main transactions table
alter table transactions add column if not exists source text default 'plaid';
alter table transactions add column if not exists p2p_counterparty text;
alter table transactions add column if not exists p2p_note text;
alter table transactions add column if not exists p2p_platform text; -- 'paypal', 'venmo', 'cashapp'
alter table transactions add column if not exists external_id text; -- PayPal/Venmo transaction ID

-- Index for filtering by source
create index if not exists tx_source_idx on transactions(clerk_user_id, source);

-- Unique constraint for P2P dedup (only where external_id is set)
create unique index if not exists tx_external_id_idx
  on transactions(clerk_user_id, source, external_id) where external_id is not null;
