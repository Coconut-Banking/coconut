import OpenAI from "openai";
import { cleanMerchantForDisplay } from "./merchant-display";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

/** In-memory cache: raw key → normalized. Persists across requests in same process. */
const cache = new Map<string, string>();

/**
 * Heuristic: should this tx description use LLM? Only triggers for long/weird ones.
 */
export function needsLLMNormalization(raw: string, category: string): boolean {
  const afterRules = cleanMerchantForDisplay(raw, category);
  if (afterRules.length <= 35) return false;
  // Long after rules
  if (afterRules.length > 45) return true;
  // Redundant pattern: "Rae Studios Raestudios-sf" or "Name Nameslug"
  if (/^(\w+(?:\s+\w+)*)\s+[a-z]+-[a-z0-9]+$/i.test(afterRules)) return true;
  if (/\b(\w+)\s+\1/i.test(afterRules)) return true; // repeated word
  return false;
}

/**
 * Batch normalize merchant names via LLM. Only call for tx that need it.
 */
export async function normalizeMerchantsWithLLM(
  items: Array<{ raw: string; category: string }>
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (!openai || items.length === 0) return result;

  const toProcess = items.filter(({ raw, category }) => {
    const key = `${raw}|${category}`;
    if (cache.has(key)) {
      result.set(raw, cache.get(key)!);
      return false;
    }
    return needsLLMNormalization(raw, category);
  });
  if (toProcess.length === 0) return result;

  const inputs = toProcess.map(({ raw, category }) => ({ raw, category }));

  const prompt = `Normalize these bank transaction descriptions into short, human-readable merchant names (max 40 chars each). Return a JSON array of strings in the exact same order.

Examples:
- "REAL TIME TRANSFER RECD FROM... FROM: Databricks Inc Via WISE" → "Databricks Pay"
- "Rae Studios Raestudios-sf" → "Rae Studios"
- "Kalshi Kalshi Acc Pay" → "Kalshi"
- "Soma Sport And Physi Sport" → "Soma Sport & Physio"

Inputs to normalize:
${JSON.stringify(inputs)}

Return ONLY a JSON array of strings, e.g. ["Name1", "Name2"]:`;

  try {
    const { choices } = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: 500,
    });
    const text = choices[0]?.message?.content?.trim() ?? "";
    const match = text.match(/\[[\s\S]*\]/);
    let arr: string[] = [];
    if (match) {
      try { arr = JSON.parse(match[0]) as string[]; }
      catch { /* malformed LLM JSON — fall through with empty arr */ }
    }
    for (let i = 0; i < toProcess.length && i < arr.length; i++) {
      const { raw, category } = toProcess[i];
      const normalized = String(arr[i] ?? raw).slice(0, 80).trim() || raw;
      result.set(raw, normalized);
      cache.set(`${raw}|${category}`, normalized);
    }
  } catch (e) {
    console.warn("[merchant-normalize-llm] LLM failed:", e);
  }
  return result;
}
