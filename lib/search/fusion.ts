/**
 * Reciprocal Rank Fusion (RRF) for merging multiple ranked result lists.
 *
 * When structured filters (date, amount) are present, the fused results are
 * intersected with the structured SQL results to enforce hard constraints.
 */
import type { ParsedQuery, SearchTransaction, RankedTransaction } from "./types";

/**
 * Reciprocal Rank Fusion.
 *
 * For each ranking list, every item at position `rank` (0-indexed) gets score
 * `1 / (k + rank + 1)`. Scores are summed across lists. Higher is better.
 *
 * @param rankings  Array of ranked transaction lists (order = relevance rank)
 * @param k         Smoothing constant (default 60, per the original RRF paper)
 */
export function reciprocalRankFusion(
  rankings: SearchTransaction[][],
  k = 60,
): Map<string, number> {
  const scores = new Map<string, number>();

  for (const ranking of rankings) {
    for (let rank = 0; rank < ranking.length; rank++) {
      const txId = ranking[rank].id;
      const current = scores.get(txId) ?? 0;
      scores.set(txId, current + 1 / (k + rank + 1));
    }
  }

  return scores;
}

/**
 * Fuse multiple retrieval results into a single deduplicated, ranked list.
 *
 * When the parsed query contains structured filters (date range, amount range),
 * and `structuredResults` is provided, the final list is intersected with the
 * structured results to guarantee hard constraints are never violated.
 */
export function fuseResults(
  vectorResults: SearchTransaction[],
  fullTextResults: SearchTransaction[],
  fuzzyResults: SearchTransaction[],
  structuredResults: SearchTransaction[],
  parsed: ParsedQuery,
  topK = 50,
): RankedTransaction[] {
  const hasStructuredFilters =
    parsed.structured_filters.date_range != null ||
    parsed.structured_filters.amount_range != null ||
    parsed.structured_filters.is_pending != null ||
    parsed.structured_filters.transaction_type != null;

  // Build a lookup of all transactions by ID (first occurrence wins for data)
  const txMap = new Map<string, SearchTransaction>();
  for (const list of [structuredResults, vectorResults, fullTextResults, fuzzyResults]) {
    for (const tx of list) {
      if (!txMap.has(tx.id)) txMap.set(tx.id, tx);
    }
  }

  // Compute RRF scores across all non-empty ranking lists
  const rankingLists = [vectorResults, fullTextResults, fuzzyResults, structuredResults]
    .filter((r) => r.length > 0);

  if (rankingLists.length === 0) return [];

  const scores = reciprocalRankFusion(rankingLists);

  // If structured filters were active, intersect with structured result IDs.
  // When structured search returns 0 results with active filters, that means
  // NO transactions match the hard constraints — return empty.
  let candidateIds: Set<string>;
  if (hasStructuredFilters) {
    if (structuredResults.length === 0) {
      return [];
    }
    const structuredIds = new Set(structuredResults.map((tx) => tx.id));
    candidateIds = new Set(
      [...scores.keys()].filter((id) => structuredIds.has(id))
    );
  } else {
    candidateIds = new Set(scores.keys());
  }

  // Build ranked output
  const ranked: RankedTransaction[] = [];
  for (const id of candidateIds) {
    const tx = txMap.get(id);
    const score = scores.get(id);
    if (tx && score != null) {
      ranked.push({ ...tx, score });
    }
  }

  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, topK);
}
