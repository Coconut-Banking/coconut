/**
 * Centralized application constants.
 * Tuning knobs and limits that were previously scattered as magic numbers.
 */

export const SEARCH = {
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 50,
  TX_FETCH_LIMIT: 2000,
  VECTOR_LIMIT: 50,
  RESULT_LIMIT: 50,
} as const;

export const GMAIL = {
  DEFAULT_SCAN_DAYS: 7,
  MAX_RESULTS: 200,
  EMAIL_MAX_CHARS: 12_000,
  PARSE_CONCURRENCY: 5,
  PARSE_TIMEOUT_MS: 30_000,
  RECEIPT_KEYWORDS: [
    "receipt",
    '"order confirmation"',
    '"payment confirmation"',
    '"your order"',
    '"your purchase"',
    '"your receipt"',
    '"order total"',
    '"payment received"',
    '"payment processed"',
    '"thank you for your order"',
    '"thank you for your purchase"',
    '"has been charged"',
    '"purchase receipt"',
    '"transaction receipt"',
    "invoice",
  ],
  RECEIPT_MERCHANTS: [
    "amazon.com",
    "amazon.ca",
    "uber.com",
    "doordash.com",
    "apple.com",
    "google.com",
    "walmart.com",
    "target.com",
    "costco.com",
    "instacart.com",
    "spotify.com",
    "netflix.com",
    "grubhub.com",
    "lyft.com",
    "shopify.com",
    "squareup.com",
    "paypal.com",
    "stripe.com",
    "bestbuy.com",
    "chewy.com",
  ],
  RECEIPT_EXCLUSIONS: ["-label:spam", "-label:trash", "-category:promotions"],
  /** Senders whose emails should never be treated as expense receipts. */
  EXCLUDED_SENDERS: [
    "wealthsimple.com",
    "questrade.com",
    "interactivebrokers.com",
    "tdameritrade.com",
    "schwab.com",
    "fidelity.com",
    "etrade.com",
    "robinhood.com",
    "vanguard.com",
    "coinbase.com",
    "binance.com",
    "kraken.com",
    "riipen.com",
  ],
  /** Subject-line patterns that indicate non-receipt emails (case-insensitive). */
  EXCLUDED_SUBJECT_PATTERNS: [
    /trade\s+confirm/i,
    /order\s+(executed|filled|confirm)/i,
    /buy\s+order/i,
    /sell\s+order/i,
    /dividend/i,
    /investment\s+(confirm|statement|summary)/i,
    /portfolio/i,
    /you('ve| have) (been|earned|received a?) (paid|hired|accepted|offer)/i,
    /job\s+(offer|payment|earning)/i,
    /pay(ment|roll)?\s+(stub|slip|statement|deposit)/i,
    /direct\s+deposit/i,
    /your\s+earning/i,
  ],
} as const;

export const RECEIPT_MATCH = {
  AMOUNT_TOLERANCE_DOLLARS: 5,
  AMOUNT_TOLERANCE_PERCENT: 0.10,
  DATE_WINDOW_DAYS: 7,
  MIN_KEYWORD_LENGTH: 3,
  STOP_WORDS: new Set([
    "the", "and", "for", "inc", "llc", "ltd", "com", "www", "online",
    "payment", "pay", "purchase", "store", "shop",
  ]),
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

/** Cache TTL in seconds for Supabase query results. Reduces egress. */
export const CACHE = {
  TRANSACTIONS_REVALIDATE_SEC: 120,
  SPLIT_IDS_REVALIDATE_SEC: 60,
} as const;
