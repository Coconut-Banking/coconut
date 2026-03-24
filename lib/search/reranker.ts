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

export interface RerankerResult {
  transactions: SearchTransaction[];
  relevantMerchantNames: string[];
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
    return { transactions: candidates, relevantMerchantNames: [] };
  }

  // For very small result sets, skip the LLM call
  if (candidates.length <= 3) {
    const names = [...new Set(candidates.map((tx) => (tx.merchant_name || tx.raw_name || "").trim().toLowerCase()).filter(Boolean))];
    return { transactions: candidates, relevantMerchantNames: names };
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

  const allEntries = [...merchantGroups.entries()];
  const merchantKeys = [...merchantGroups.keys()];

  function buildPrompt(batch: [string, { count: number; sample: SearchTransaction }][]): string {
    const list = batch.map(([, v], i) => {
      const s = v.sample;
      const cat = s.primary_category?.replace(/_/g, " ") ?? "unknown";
      const detail = s.detailed_category?.replace(/_/g, " ") ?? "";
      const catStr = detail ? `${cat} > ${detail}` : cat;
      const merchant = s.merchant_name || s.raw_name || "Unknown";
      const rawDesc = s.raw_name && s.raw_name !== merchant ? ` [raw: "${s.raw_name}"]` : "";
      return `${i + 1}. "${merchant}"${rawDesc} (bank-tagged: ${catStr}, ${v.count}x)`;
    });

    return `A user searched their bank transactions for: "${query.trim()}"

Candidate merchants:
${list.join("\n")}

Which merchants are RELEVANT to "${query.trim()}"?

CRITICAL: The "bank-tagged" categories are FREQUENTLY WRONG. Banks miscategorize merchants constantly. Use YOUR OWN KNOWLEDGE of what each merchant actually is. Examples:
- "New Balance" tagged as FOOD — actually clothing/shoes
- Community centres tagged as RESTAURANT — actually recreation
- Transit cards (Clipper, Presto) tagged as TRANSPORTATION — NOT fuel/gas
- Train catering (Newrest) tagged as TRANSPORTATION — food on trains, NOT fuel

Concept rules:
- "eating out" / "dining" = restaurants, cafes, fast food, chicken shops, burger joints, pizza places, any place you ORDER and EAT food. Does NOT include food delivery apps (Uber Eats, DoorDash, Skip), grocery stores, vending machines, or non-food businesses.
- "gas" / "fuel" / "petrol" = gas stations ONLY (Shell, Petro-Canada, Esso, BP). NOT transit, NOT rideshare.
- "haircuts" / "barber" = barbershops and salons ONLY. NOT gyms, NOT Sephora, NOT fitness.
- "uber" (without "eats") = Uber RIDES only, NOT Uber Eats.
- "coffee" = coffee shops (Starbucks, Tim Hortons). NOT all food.

Be INCLUSIVE for the matching concept. If a merchant name sounds like it could be a restaurant (e.g. "Starbird Chicken", "Slap Burgers", "Fresh Burrito"), INCLUDE it.

Return JSON: {"relevant_merchants": [1, 3, 5]} (1-based indices from THIS batch)
If NONE match, return {"relevant_merchants": []}`;
  }

  const BATCH_SIZE = 60;
  const relevantKeys = new Set<string>();
  let batchesSucceeded = 0;

  try {
    const batchPromises: Promise<void>[] = [];

    for (let start = 0; start < allEntries.length; start += BATCH_SIZE) {
      const batch = allEntries.slice(start, start + BATCH_SIZE);
      const batchKeys = batch.map(([key]) => key);
      const prompt = buildPrompt(batch);

      batchPromises.push(
        openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" },
          temperature: 0,
          max_tokens: Math.max(300, batch.length * 8),
        }).then((completion) => {
          const raw = completion.choices[0]?.message?.content;
          if (!raw) return;
          const parsed = JSON.parse(raw) as { relevant_merchants?: unknown };
          const indices = Array.isArray(parsed.relevant_merchants) ? parsed.relevant_merchants : null;
          batchesSucceeded++;
          if (!indices) return;
          for (const idx of indices) {
            const i = typeof idx === "number" ? idx : parseInt(String(idx), 10);
            if (!isNaN(i) && i >= 1 && i <= batchKeys.length) {
              relevantKeys.add(batchKeys[i - 1]);
            }
          }
        }).catch((e) => {
          console.warn("[search-v2/reranker] batch failed:", e instanceof Error ? e.message : e);
        })
      );
    }

    await Promise.all(batchPromises);

    // If all batches failed, fall back to returning all candidates
    if (batchesSucceeded === 0) {
      return { transactions: candidates, relevantMerchantNames: [] };
    }

    if (relevantKeys.size === 0) {
      return { transactions: [], relevantMerchantNames: [] };
    }

    const reranked = candidates.filter((tx) => {
      const name = (tx.merchant_name || tx.raw_name || "Unknown").trim().toLowerCase();
      return relevantKeys.has(name);
    });

    console.log(
      `[search-v2/reranker] ${merchantGroups.size} merchants (${Math.ceil(allEntries.length / BATCH_SIZE)} batches), ${candidates.length} candidates → ${relevantKeys.size} relevant merchants, ${reranked.length} transactions`
    );

    return {
      transactions: reranked.length > 0 ? reranked : candidates,
      relevantMerchantNames: [...relevantKeys],
    };
  } catch (e) {
    console.warn("[search-v2/reranker] LLM call failed:", e);
    return { transactions: candidates, relevantMerchantNames: [] };
  }
}
