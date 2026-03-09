/**
 * Simple keyword search over transactions.
 * For user-scoped semantic search, use lib/search-engine and /api/nl-search.
 * This module is deprecated for server use; search-engine handles auth + DB.
 */
import type { Transaction } from "./types";

export function searchTransactions(
  transactions: Transaction[],
  query: string,
  limit = 20
): Transaction[] {
  const q = query.toLowerCase().trim();
  if (!q) return transactions.slice(0, limit);

  const keywords = q.split(/\s+/);
  const scored = transactions.map((t) => {
    const text = [t.merchant, t.category, (t as { rawDescription?: string }).rawDescription ?? ""]
      .join(" ")
      .toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      if (text.includes(kw)) score += 2;
      if (t.merchant.toLowerCase().includes(kw)) score += 3;
      if (t.category.toLowerCase().includes(kw)) score += 2;
    }
    return { t, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored
    .filter((x) => x.score > 0)
    .slice(0, limit)
    .map((x) => x.t);
}
