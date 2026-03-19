/**
 * Four parallel retrieval strategies for semantic search v2.
 *
 * Each retriever returns SearchTransaction[] ranked by its own relevance metric.
 * The caller (engine.ts) runs them in parallel and fuses results via RRF.
 */
import OpenAI from "openai";
import { getSupabaseAdmin } from "../supabase";
import type { ParsedQuery, SearchTransaction } from "./types";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const DEFAULT_LIMIT = 50;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildAmountFilters(parsed: ParsedQuery): { min: number | null; max: number | null } {
  const range = parsed.structured_filters.amount_range;
  if (!range) return { min: null, max: null };
  return {
    min: range.min ?? null,
    max: range.max ?? null,
  };
}

function castRows(data: unknown): SearchTransaction[] {
  if (!Array.isArray(data)) return [];
  return data as SearchTransaction[];
}

function escapeLikePattern(s: string): string {
  return s.replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * Escape characters that have special meaning in PostgREST filter syntax.
 * Commas separate clauses, dots separate field.operator.value, and
 * parentheses denote grouping. URL-encoding them prevents user input
 * from breaking out of a .or() filter string.
 */
function escapePostgrestValue(s: string): string {
  return s
    .replace(/%/g, "%25")
    .replace(/,/g, "%2C")
    .replace(/\./g, "%2E")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");
}

// ─── 1. Vector Similarity Search (pgvector on rich_embedding) ─────────────────

export async function vectorSearch(
  clerkUserId: string,
  parsed: ParsedQuery,
  limit = DEFAULT_LIMIT,
): Promise<SearchTransaction[]> {
  if (!openai) return [];

  const { data: embData } = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: parsed.semantic_terms,
  });
  if (!embData?.length || !embData[0]?.embedding) return [];

  const dateRange = parsed.structured_filters.date_range;
  const { min: amountMin, max: amountMax } = buildAmountFilters(parsed);
  const db = getSupabaseAdmin();

  const { data, error } = await db.rpc("vector_search_transactions_v2", {
    p_user_id: clerkUserId,
    p_embedding: JSON.stringify(embData[0].embedding),
    p_date_start: dateRange?.start ?? null,
    p_date_end: dateRange?.end ?? null,
    p_amount_min: amountMin,
    p_amount_max: amountMax,
    p_limit: limit,
  });

  if (error) {
    console.warn("[search-v2/vector] RPC error:", error.message);
    return [];
  }
  return castRows(data);
}

// ─── 2. Full-Text Search (tsvector + ts_rank) ────────────────────────────────

export async function fullTextSearch(
  clerkUserId: string,
  parsed: ParsedQuery,
  limit = DEFAULT_LIMIT,
): Promise<SearchTransaction[]> {
  const searchTerms = parsed.semantic_terms;
  if (!searchTerms.trim()) return [];

  const dateRange = parsed.structured_filters.date_range;
  const { min: amountMin, max: amountMax } = buildAmountFilters(parsed);
  const db = getSupabaseAdmin();

  // Try tsvector RPC first
  const { data, error } = await db.rpc("fulltext_search_transactions", {
    p_user_id: clerkUserId,
    p_query: searchTerms,
    p_date_start: dateRange?.start ?? null,
    p_date_end: dateRange?.end ?? null,
    p_amount_min: amountMin,
    p_amount_max: amountMax,
    p_limit: limit,
  });

  if (!error && data && (data as unknown[]).length > 0) {
    return castRows(data);
  }

  // Fallback: ILIKE on embed_text for conceptual terms that tsvector misses
  // (e.g. "gas fuel" won't match tsvector built from "Petro-Canada" + "TRANSPORTATION")
  const keywords = searchTerms.split(/\s+/).filter((w) => w.length >= 3).slice(0, 4);
  if (keywords.length === 0) return [];

  let fallback = db
    .from("transactions")
    .select(
      "id, plaid_transaction_id, account_id, merchant_name, raw_name, normalized_merchant, " +
      "amount, date, primary_category, detailed_category, iso_currency_code, is_pending, embed_text"
    )
    .eq("clerk_user_id", clerkUserId)
    .order("date", { ascending: false })
    .limit(limit);

  if (dateRange) {
    fallback = fallback.gte("date", dateRange.start).lte("date", dateRange.end);
  }
  if (amountMin != null) fallback = fallback.gte("amount", amountMin);
  if (amountMax != null) fallback = fallback.lte("amount", amountMax);

  const orClauses = keywords.map((kw) => {
    const escaped = escapePostgrestValue(escapeLikePattern(kw));
    return `embed_text.ilike.%${escaped}%`;
  });
  fallback = fallback.or(orClauses.join(","));

  const { data: fbData, error: fbError } = await fallback;
  if (fbError) {
    console.warn("[search-v2/fulltext-fallback] error:", fbError.message);
    return [];
  }
  return castRows(fbData);
}

// ─── 3. Trigram Fuzzy Matching (pg_trgm on normalized_merchant) ──────────────

export async function fuzzyMerchantSearch(
  clerkUserId: string,
  parsed: ParsedQuery,
  limit = 30,
): Promise<SearchTransaction[]> {
  const merchantQuery = parsed.merchant_search;
  if (!merchantQuery) return [];

  const dateRange = parsed.structured_filters.date_range;
  const { min: amountMin, max: amountMax } = buildAmountFilters(parsed);
  const db = getSupabaseAdmin();

  const { data, error } = await db.rpc("fuzzy_search_merchant", {
    p_user_id: clerkUserId,
    p_merchant_query: merchantQuery,
    p_date_start: dateRange?.start ?? null,
    p_date_end: dateRange?.end ?? null,
    p_amount_min: amountMin,
    p_amount_max: amountMax,
    p_similarity_min: 0.25,
    p_limit: limit,
  });

  if (error) {
    console.warn("[search-v2/fuzzy] RPC error:", error.message);
    return [];
  }
  return castRows(data);
}

// ─── 4. Structured SQL Filters ───────────────────────────────────────────────

export async function structuredSearch(
  clerkUserId: string,
  parsed: ParsedQuery,
  limit = 200,
): Promise<SearchTransaction[]> {
  const db = getSupabaseAdmin();

  let query = db
    .from("transactions")
    .select(
      "id, plaid_transaction_id, account_id, merchant_name, raw_name, normalized_merchant, " +
      "amount, date, primary_category, detailed_category, iso_currency_code, is_pending, embed_text"
    )
    .eq("clerk_user_id", clerkUserId)
    .order("date", { ascending: false })
    .limit(limit);

  const { date_range, amount_range, is_pending, transaction_type } = parsed.structured_filters;

  if (date_range) {
    query = query.gte("date", date_range.start).lte("date", date_range.end);
  }

  if (amount_range) {
    if (amount_range.min != null) query = query.gte("amount", amount_range.min);
    if (amount_range.max != null) query = query.lte("amount", amount_range.max);
  }

  if (is_pending != null) {
    query = query.eq("is_pending", is_pending);
  }

  if (transaction_type === "expense") {
    query = query.lt("amount", 0);
  } else if (transaction_type === "income") {
    query = query.gt("amount", 0);
  } else if (transaction_type === "refund") {
    query = query.gt("amount", 0);
  }

  if (parsed.merchant_search) {
    const escaped = escapePostgrestValue(escapeLikePattern(parsed.merchant_search));
    const pattern = `%${escaped}%`;
    query = query.or(
      `merchant_name.ilike.${pattern},raw_name.ilike.${pattern},normalized_merchant.ilike.${pattern}`
    );
  }

  const { data, error } = await query;
  if (error) {
    console.warn("[search-v2/structured] query error:", error.message);
    return [];
  }
  return castRows(data);
}
