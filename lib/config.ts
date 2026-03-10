/**
 * Centralized application constants.
 * Tuning knobs and limits that were previously scattered as magic numbers.
 */

export const SEARCH = {
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 50,
  TX_FETCH_LIMIT: 2000,
  VECTOR_LIMIT: 20,
  RESULT_LIMIT: 50,
} as const;

export const GMAIL = {
  DEFAULT_SCAN_DAYS: 7,
  MAX_RESULTS: 200,
  EMAIL_MAX_CHARS: 12_000,
} as const;

export const AI = {
  MODEL: "gpt-4o-mini" as const,
  CHAT_TX_CONTEXT_LIMIT: 30,
  CHAT_MAX_TOKENS: 500,
  SEARCH_INTENT_MAX_TOKENS: 200,
  RECEIPT_OCR_MAX_TOKENS: 2000,
} as const;

export const SYNC = {
  UPSERT_BATCH: 100,
  EMBED_CANDIDATES_LIMIT: 1000,
  EMBED_BATCH: 100,
  PLAID_SYNC_COUNT: 500,
  PLAID_HISTORY_DAYS: 730,
} as const;

export const EMAIL_RECEIPTS = {
  PAGE_SIZE: 100,
} as const;
