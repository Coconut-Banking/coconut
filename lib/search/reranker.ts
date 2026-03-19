/**
 * LLM-based re-ranking and filtering of candidate transactions.
 *
 * Takes the top ~50 candidates from fusion and asks an LLM to:
 *   1. Filter out irrelevant results
 *   2. Rank remaining by relevance to the original query
 *
 * This is the accuracy guarantee — the LLM understands nuance that
 * retrieval methods alone cannot capture.
 */
import OpenAI from "openai";
import type { RankedTransaction, SearchTransaction } from "./types";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

function formatTxForLLM(tx: SearchTransaction, index: number): string {
  const merchant = tx.merchant_name || tx.raw_name || "Unknown";
  const amount = `$${Math.abs(tx.amount).toFixed(2)}`;
  const type = tx.amount < 0 ? "expense" : "credit/refund";
  const category = tx.primary_category?.replace(/_/g, " ") ?? "unknown";
  const detail = tx.detailed_category?.replace(/_/g, " ") ?? "";
  const catStr = detail ? `${category} > ${detail}` : category;
  return `${index + 1}. ${amount} ${type} at "${merchant}" on ${tx.date} (${catStr})${tx.is_pending ? " [pending]" : ""}`;
}

interface RerankerResult {
  transactions: SearchTransaction[];
  reasoning?: string;
}

/**
 * Re-rank and filter candidate transactions using an LLM.
 *
 * Uses a merchant-grouping strategy: instead of asking the LLM to evaluate
 * each transaction individually (fails for 50+ results), we deduplicate by
 * merchant name, ask the LLM which merchants are relevant, then return ALL
 * transactions from those merchants.
 *
 * @param query         The original user query
 * @param candidates    Fused candidates
 * @returns             Filtered and re-ranked transactions
 */
export async function rerankWithLLM(
  query: string,
  candidates: RankedTransaction[],
): Promise<RerankerResult> {
  if (!openai || candidates.length === 0) {
    return { transactions: candidates };
  }

  // For very small result sets, skip the LLM call
  if (candidates.length <= 3) {
    return { transactions: candidates };
  }

  // Group by merchant to avoid per-transaction evaluation
  const merchantGroups = new Map<string, { count: number; sample: SearchTransaction }>();
  for (const tx of candidates) {
    const name = (tx.merchant_name || tx.raw_name || "Unknown").trim();
    const key = name.toLowerCase();
    if (!merchantGroups.has(key)) {
      merchantGroups.set(key, { count: 0, sample: tx });
    }
    merchantGroups.get(key)!.count++;
  }

  const merchantList = [...merchantGroups.entries()].map(([, v], i) => {
    const s = v.sample;
    const cat = s.primary_category?.replace(/_/g, " ") ?? "unknown";
    const detail = s.detailed_category?.replace(/_/g, " ") ?? "";
    const catStr = detail ? `${cat} > ${detail}` : cat;
    const merchant = s.merchant_name || s.raw_name || "Unknown";
    return `${i + 1}. "${merchant}" (${catStr}, ${v.count} transaction${v.count === 1 ? "" : "s"})`;
  });

  const prompt = `A user searched their bank transactions for: "${query.trim()}"

These merchants appeared in the candidate results:
${merchantList.join("\n")}

Which of these merchants are RELEVANT to the search query "${query.trim()}"?

Rules:
- Be INCLUSIVE — if a merchant could reasonably match the query, INCLUDE it.
- "gas" / "fuel" → include gas stations (Shell, Petro-Canada, Esso, Pioneer, etc.)
- "food" / "eating out" → include restaurants, fast food, cafes, but NOT grocery stores
- "coffee" → include coffee shops (Starbucks, Tim Hortons, etc.)
- "subscriptions" → include streaming, recurring payments (Netflix, Spotify, gym, etc.)
- "Uber Eats" is food delivery, NOT rideshare. "Uber" rides are rideshare.
- When in doubt, INCLUDE the merchant.

Return JSON: {"relevant_merchants": [1, 3, 5]} (1-based indices of relevant merchants)
If ALL merchants are relevant, return ALL indices.
If NONE match, return {"relevant_merchants": []}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: Math.max(300, merchantGroups.size * 8),
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) return { transactions: candidates };

    const parsed = JSON.parse(raw) as { relevant_merchants?: unknown };
    const indices = Array.isArray(parsed.relevant_merchants) ? parsed.relevant_merchants : null;

    if (!indices || indices.length === 0) {
      return { transactions: [] };
    }

    // Map indices back to merchant keys
    const merchantKeys = [...merchantGroups.keys()];
    const relevantKeys = new Set<string>();
    for (const idx of indices) {
      const i = typeof idx === "number" ? idx : parseInt(String(idx), 10);
      if (!isNaN(i) && i >= 1 && i <= merchantKeys.length) {
        relevantKeys.add(merchantKeys[i - 1]);
      }
    }

    if (relevantKeys.size === 0) return { transactions: candidates };

    // Return ALL transactions from relevant merchants (not just the top 50)
    const reranked = candidates.filter((tx) => {
      const name = (tx.merchant_name || tx.raw_name || "Unknown").trim().toLowerCase();
      return relevantKeys.has(name);
    });

    console.log(
      `[search-v2/reranker] ${merchantGroups.size} merchants, ${candidates.length} candidates → ${relevantKeys.size} relevant merchants, ${reranked.length} transactions`
    );

    return { transactions: reranked.length > 0 ? reranked : candidates };
  } catch (e) {
    console.warn("[search-v2/reranker] LLM call failed:", e);
    return { transactions: candidates };
  }
}
