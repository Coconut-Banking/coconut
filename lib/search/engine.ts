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
import { vectorSearch, fullTextSearch, fuzzyMerchantSearch, structuredSearch } from "./retrievers";
import { fuseResults } from "./fusion";
import { rerankWithLLM } from "./reranker";
import type { ParsedQuery, SearchTransaction, SearchV2Result } from "./types";

function fmt(amount: number): string {
  return Math.abs(amount).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function generateAnswer(
  query: string,
  parsed: ParsedQuery,
  transactions: SearchTransaction[],
): { answer: string; total: number | null; count: number } {
  const count = transactions.length;

  if (parsed.intent === "aggregate") {
    if (count === 0) {
      return { answer: "No matching transactions found.", total: 0, count: 0 };
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
    return { answer: "No matching transactions found.", total: null, count: 0 };
  }
  return {
    answer: `Found ${count} matching transaction${count === 1 ? "" : "s"}.`,
    total: null,
    count,
  };
}

export interface SearchV2Options {
  maxCandidates?: number;
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
  console.log("[search-v2] parsed query:", JSON.stringify(parsed));

  // For aggregate/count queries, we need ALL matching transactions, not a top-K sample
  const needsAllResults = parsed.intent === "aggregate" || parsed.intent === "count";
  const vectorLimit = needsAllResults ? 100 : (opts?.maxCandidates ?? 50);
  const fusionLimit = needsAllResults ? 500 : (opts?.maxCandidates ?? 50);

  // ── Step 2: Parallel Multi-Strategy Retrieval ──────────────────────────
  const [vectorResults, fullTextResults, fuzzyResults, structuredResults] =
    await Promise.all([
      vectorSearch(clerkUserId, parsed, vectorLimit).catch((e) => {
        console.warn("[search-v2] vector search failed:", e);
        return [] as SearchTransaction[];
      }),
      fullTextSearch(clerkUserId, parsed, vectorLimit).catch((e) => {
        console.warn("[search-v2] full-text search failed:", e);
        return [] as SearchTransaction[];
      }),
      fuzzyMerchantSearch(clerkUserId, parsed).catch((e) => {
        console.warn("[search-v2] fuzzy search failed:", e);
        return [] as SearchTransaction[];
      }),
      structuredSearch(clerkUserId, parsed, needsAllResults ? 1000 : 200).catch((e) => {
        console.warn("[search-v2] structured search failed:", e);
        return [] as SearchTransaction[];
      }),
    ]);

  console.log(
    `[search-v2] retrieval results — vector: ${vectorResults.length}, ` +
    `fulltext: ${fullTextResults.length}, fuzzy: ${fuzzyResults.length}, ` +
    `structured: ${structuredResults.length}`
  );

  // ── Step 3: Candidate Fusion (RRF) ────────────────────────────────────
  const fused = fuseResults(
    vectorResults,
    fullTextResults,
    fuzzyResults,
    structuredResults,
    parsed,
    fusionLimit,
  );

  console.log(`[search-v2] fused candidates: ${fused.length}`);

  // ── Step 4: LLM Re-Ranking ────────────────────────────────────────────
  const { transactions: reranked } = await rerankWithLLM(query, fused);

  console.log(`[search-v2] after reranking: ${reranked.length}`);

  // ── Step 5: Result Formatting ─────────────────────────────────────────
  const { answer, total, count } = generateAnswer(query, parsed, reranked);

  return {
    intent: parsed.intent,
    transactions: reranked,
    total,
    count,
    answer,
  };
}
