/**
 * Semantic Search v2 — Main Orchestrator
 *
 * Pipeline:
 *   1. Query Understanding (LLM) → ParsedQuery
 *   2. Parallel Multi-Strategy Retrieval (vector, full-text, fuzzy, structured)
 *   3. Candidate Fusion (RRF + structured intersection)
 *   4. LLM Re-Ranking (accuracy guarantee)
 *   5. Result formatting + optional aggregation
 *
 * This file does NOT modify the existing lib/search-engine.ts.
 */
import { parseQuery } from "./query-parser";
import { vectorSearch, fullTextSearch, fuzzyMerchantSearch, structuredSearch, expandByMerchants, escapePostgrestValue, escapeLikePattern } from "./retrievers";
import { fuseResults } from "./fusion";
import { rerankWithLLM } from "./reranker";
import { getSupabaseAdmin } from "../supabase";
import type { ParsedQuery, SearchTransaction, RankedTransaction, SearchV2Result } from "./types";

function fmt(amount: number): string {
  return Math.abs(amount).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function generateAnswer(
  query: string,
  parsed: ParsedQuery,
  transactions: SearchTransaction[],
  locationFallback?: boolean,
): { answer: string; total: number | null; count: number } {
  const count = transactions.length;

  if (parsed.intent === "aggregate") {
    if (count === 0) {
      return {
        answer: locationFallback
          ? "No transactions found. Your bank likely doesn't provide location data for these transactions — try searching by merchant name instead."
          : "No matching transactions found.",
        total: 0,
        count: 0,
      };
    }
    const txType = parsed.structured_filters.transaction_type;
    if (txType === "income" || txType === "refund") {
      const credits = transactions.filter((t) => t.amount > 0);
      const total = credits.reduce((sum, t) => sum + t.amount, 0);
      const label = txType === "income" ? "received" : "got back";
      return {
        answer: `You ${label} ${fmt(total)} across ${credits.length} transaction${credits.length === 1 ? "" : "s"}.`,
        total,
        count: credits.length,
      };
    }
    const expenses = transactions.filter((t) => t.amount < 0);
    const total = expenses.reduce((sum, t) => sum + Math.abs(t.amount), 0);
    return {
      answer: `You spent ${fmt(total)} across ${expenses.length} transaction${expenses.length === 1 ? "" : "s"}.`,
      total,
      count: expenses.length,
    };
  }

  if (parsed.intent === "count") {
    return {
      answer: count === 0
        ? "No matching transactions found."
        : `Found ${count} matching transaction${count === 1 ? "" : "s"}.`,
      total: null,
      count,
    };
  }

  // search
  if (count === 0) {
    return {
      answer: locationFallback
        ? "No transactions found. Your bank likely doesn't provide location data for these transactions — try searching by merchant name instead."
        : "No matching transactions found.",
      total: null,
      count: 0,
    };
  }
  return {
    answer: `Found ${count} matching transaction${count === 1 ? "" : "s"}.`,
    total: null,
    count,
  };
}

export interface SearchV2Options {
  maxCandidates?: number;
  dateOverride?: { start: string; end: string };
  accountId?: string;
  location?: string;
}

/**
 * Run the full semantic search v2 pipeline.
 *
 * @param clerkUserId  The authenticated user's Clerk ID
 * @param query        The natural-language search query
 * @param opts         Optional tuning parameters
 */
export async function searchV2(
  clerkUserId: string,
  query: string,
  opts?: SearchV2Options,
): Promise<SearchV2Result> {
  // ── Step 1: Query Understanding ────────────────────────────────────────
  const parsed = await parseQuery(query);

  // Apply mobile app overrides (calendar/location pickers take precedence over LLM)
  if (opts?.dateOverride) {
    parsed.structured_filters.date_range = opts.dateOverride;
  }
  if (opts?.location) {
    parsed.structured_filters.location = opts.location;
  }

  console.log("[search-v2] parsed query:", JSON.stringify(parsed));

  let reranked: SearchTransaction[];

  // ── Location-only queries skip merchant reranking ────────────────────
  // "transactions in California last week" → just filter by location + date
  const isLocationOnlyQuery = !!parsed.structured_filters.location &&
    !parsed.merchant_search &&
    (!parsed.semantic_terms || parsed.semantic_terms === query.trim());

  if (isLocationOnlyQuery) {
    reranked = await expandByMerchants(clerkUserId, [], parsed, opts?.accountId);
    reranked.sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0));
    console.log(`[search-v2] location query — ${reranked.length} transactions`);

    if (reranked.length > 0) {
      const { answer, total, count } = generateAnswer(query, parsed, reranked);
      const dates = reranked.map((t) => t.date).filter(Boolean).sort();
      return {
        intent: parsed.intent,
        transactions: reranked,
        total,
        count,
        answer,
        date_range: dates.length > 0 ? { earliest: dates[0], latest: dates[dates.length - 1] } : null,
        applied_filters: {
          date_start: parsed.structured_filters.date_range?.start ?? null,
          date_end: parsed.structured_filters.date_range?.end ?? null,
          account_id: opts?.accountId ?? null,
          location: parsed.structured_filters.location ?? null,
        },
      };
    }

    // No structured location data found — fall through to semantic pipeline.
    // Most credit card transactions don't have city/region populated by Plaid.
    // Use the full query as semantic terms so vector search can still surface
    // relevant results (e.g. merchants the user visited in that location).
    console.log(`[search-v2] location query returned 0 — falling back to semantic pipeline`);
    parsed.semantic_terms = query;
    // Keep the date range filter but drop the location requirement
    parsed.structured_filters.location = undefined;
  }

  // ── Step 2: Fetch the user's distinct merchant list ──────────────────
  const db = getSupabaseAdmin();

  let merchantQuery = db
    .from("transactions")
    .select("merchant_name, raw_name, normalized_merchant, primary_category, detailed_category")
    .eq("clerk_user_id", clerkUserId);

  if (opts?.accountId) {
    merchantQuery = merchantQuery.eq("account_id", opts.accountId);
  }

  const { date_range, amount_range, transaction_type, location } = parsed.structured_filters;
  if (date_range) {
    merchantQuery = merchantQuery.gte("date", date_range.start).lte("date", date_range.end);
  }
  if (amount_range) {
    if (amount_range.min != null) merchantQuery = merchantQuery.gte("amount", amount_range.min);
    if (amount_range.max != null) merchantQuery = merchantQuery.lte("amount", amount_range.max);
  }
  if (transaction_type === "expense") {
    merchantQuery = merchantQuery.lt("amount", 0);
  } else if (transaction_type === "income" || transaction_type === "refund") {
    merchantQuery = merchantQuery.gt("amount", 0);
  }
  if (location) {
    const escaped = escapePostgrestValue(escapeLikePattern(location));
    merchantQuery = merchantQuery.or(
      `city.ilike.%${escaped}%,region.ilike.%${escaped}%,country.ilike.%${escaped}%`
    );
  }

  const { data: allTxRows } = await merchantQuery.limit(5000);

  // Deduplicate to one sample per merchant
  const merchantMap = new Map<string, SearchTransaction>();
  for (const row of (allTxRows ?? []) as SearchTransaction[]) {
    const key = (row.normalized_merchant || row.merchant_name || row.raw_name || "").toLowerCase().trim();
    if (key && !merchantMap.has(key)) {
      merchantMap.set(key, row);
    }
  }

  const uniqueMerchantSamples = [...merchantMap.values()];
  console.log(`[search-v2] unique merchants: ${uniqueMerchantSamples.length}`);

  // ── Step 3: Also run vector search for semantic discovery ────────────
  // Vector search helps surface merchants that are semantically relevant
  // but might not be obvious from name alone (e.g. "Starbird Chicken"
  // for "eating out"). Merge its merchants into the set.
  const vectorResults = await vectorSearch(clerkUserId, parsed, 80).catch((e) => {
    console.warn("[search-v2] vector search failed:", e);
    return [] as SearchTransaction[];
  });

  for (const tx of vectorResults) {
    const key = (tx.normalized_merchant || tx.merchant_name || tx.raw_name || "").toLowerCase().trim();
    if (key && !merchantMap.has(key)) {
      merchantMap.set(key, tx);
      uniqueMerchantSamples.push(tx);
    }
  }

  // If merchant_search is set, also add fuzzy matches
  if (parsed.merchant_search) {
    const fuzzyResults = await fuzzyMerchantSearch(clerkUserId, parsed).catch(() => [] as SearchTransaction[]);
    for (const tx of fuzzyResults) {
      const key = (tx.normalized_merchant || tx.merchant_name || tx.raw_name || "").toLowerCase().trim();
      if (key && !merchantMap.has(key)) {
        merchantMap.set(key, tx);
        uniqueMerchantSamples.push(tx);
      }
    }
  }

  console.log(`[search-v2] total unique merchants (with vector/fuzzy): ${uniqueMerchantSamples.length}`);

  // ── Step 4: Reranker decides which merchants are relevant ────────────
  const asRanked: RankedTransaction[] = uniqueMerchantSamples.map((tx) => ({ ...tx, score: 1 }));
  const { relevantMerchantNames } = await rerankWithLLM(query, asRanked);

  // ── Step 5: Expand — fetch ALL transactions from relevant merchants ──
  reranked = await expandByMerchants(clerkUserId, relevantMerchantNames, parsed, opts?.accountId);

  console.log(`[search-v2] after expansion: ${reranked.length} transactions from ${relevantMerchantNames.length} merchants`);

  // Sort results reverse-chronologically (most recent first)
  reranked.sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0));

  // ── Step 6: Result Formatting ─────────────────────────────────────────
  const { answer, total, count } = generateAnswer(query, parsed, reranked);

  const dates = reranked.map((t) => t.date).filter(Boolean).sort();
  const dateRange = dates.length > 0
    ? { earliest: dates[0], latest: dates[dates.length - 1] }
    : null;

  return {
    intent: parsed.intent,
    transactions: reranked,
    total,
    count,
    answer,
    date_range: dateRange,
    applied_filters: {
      date_start: parsed.structured_filters.date_range?.start ?? null,
      date_end: parsed.structured_filters.date_range?.end ?? null,
      account_id: opts?.accountId ?? null,
      location: parsed.structured_filters.location ?? null,
    },
  };
}
