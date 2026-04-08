-- Background job queue for async Plaid syncs triggered by webhooks.
-- Jobs are inserted by webhook handlers and processed by /api/cron/process-jobs (runs every minute).
create table if not exists job_queue (
  id           uuid primary key default gen_random_uuid(),
  type         text not null,                    -- 'plaid_sync'
  payload      jsonb not null default '{}',
  status       text not null default 'pending'
               check (status in ('pending', 'processing', 'done', 'failed')),
  clerk_user_id text,                            -- denormalised for tracing / alerts
  locked_at    timestamptz,                      -- set when a worker claims the job
  created_at   timestamptz not null default now(),
  processed_at timestamptz,
  error        text
);

-- Fast lookup for the worker: only pending jobs, ordered by age
create index if not exists job_queue_pending_idx
  on job_queue (created_at)
  where status = 'pending';

-- Stale-processing reclaim: find jobs stuck in processing
create index if not exists job_queue_processing_idx
  on job_queue (locked_at)
  where status = 'processing';

-- Auto-clean jobs older than 7 days (keeps table small)
-- Run manually or add to a weekly maintenance cron:
-- delete from job_queue where created_at < now() - interval '7 days';
