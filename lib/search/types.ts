/**
 * Shared types for the semantic search v2 pipeline.
 */

export interface ParsedQuery {
  structured_filters: {
    date_range?: { start: string; end: string };
    amount_range?: { min?: number; max?: number };
    is_pending?: boolean;
    transaction_type?: "expense" | "income" | "refund";
    location?: string;
  };
  semantic_terms: string;
  merchant_search?: string;
  intent: "search" | "aggregate" | "count";
}

export interface SearchTransaction {
  id: string;
  plaid_transaction_id: string;
  account_id: string | null;
  merchant_name: string | null;
  raw_name: string | null;
  normalized_merchant: string | null;
  amount: number;
  date: string;
  primary_category: string | null;
  detailed_category: string | null;
  iso_currency_code: string | null;
  is_pending: boolean;
  embed_text: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
}

export interface RankedTransaction extends SearchTransaction {
  score: number;
}

export interface SearchV2Result {
  intent: ParsedQuery["intent"];
  transactions: SearchTransaction[];
  total: number | null;
  count: number;
  answer: string;
  date_range: { earliest: string; latest: string } | null;
  applied_filters: {
    date_start: string | null;
    date_end: string | null;
    account_id: string | null;
    location: string | null;
  };
}
