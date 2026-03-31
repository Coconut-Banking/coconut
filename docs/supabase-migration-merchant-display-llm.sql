-- Persist LLM-shortened merchant labels so GET /api/plaid/transactions does not re-call OpenAI per row.
-- Apply in Supabase SQL editor (do not auto-run against production without review).

alter table transactions add column if not exists merchant_display_llm text;

comment on column transactions.merchant_display_llm is
  'Optional display name from merchant LLM normalization; merchant_name/raw_name remain from Plaid.';
