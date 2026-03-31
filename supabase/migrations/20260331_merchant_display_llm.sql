alter table transactions add column if not exists merchant_display_llm text;

comment on column transactions.merchant_display_llm is
  'Optional display name from merchant LLM normalization; merchant_name/raw_name remain from Plaid.';
