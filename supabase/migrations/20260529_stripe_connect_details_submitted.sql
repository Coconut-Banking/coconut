-- Persist Stripe onboarding progress for Settings payout status (updated by webhook + status sync).
alter table stripe_connected_accounts
  add column if not exists details_submitted boolean not null default false;

comment on column stripe_connected_accounts.details_submitted is
  'True after user submits Connect onboarding; used for pending_review vs setup_required in app.';
