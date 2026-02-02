import type { Transaction } from "./types";
import { getTransactions } from "./data";

// Simple semantic-ish search: keyword match + category awareness (no API key required).
// When OPENAI_API_KEY is set, we use embeddings in the API route instead.
export function searchTransactions(query: string, limit = 20): Transaction[] {
  const transactions = getTransactions();
  const q = query.toLowerCase().trim();
  if (!q) return transactions.slice(0, limit);

  const keywords = q.split(/\s+/);
  const scored = transactions.map((t) => {
    const text = [t.merchant, t.category, t.rawDescription].join(" ").toLowerCase();
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
