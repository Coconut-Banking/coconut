import OpenAI from "openai";
import { cleanMerchantForDisplay } from "./merchant-display";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

/** In-memory cache: raw key → normalized. Persists across requests in same process. */
const cache = new Map<string, string>();

/** After OpenAI 429, skip LLM briefly (serverless has no shared cache — parallel tx GETs hammer TPM). */
let openAiCooldownUntil = 0;

function isOpenAiRateLimitError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as { status?: number; code?: string };
  return err.status === 429 || err.code === "rate_limit_exceeded";
}

/** Cap OpenAI input per request; DB persistence means the rest fill in on later loads. */
const MAX_LLM_ITEMS_PER_REQUEST = 35;

/** Map key for LLM results (same raw can appear under different categories). */
export function merchantLlmResultKey(raw: string, category: string): string {
  return `${raw}\u001f${category}`;
}

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
 * Returned map keys are `merchantLlmResultKey(raw, category)`.
 */
export async function normalizeMerchantsWithLLM(
  items: Array<{ raw: string; category: string }>
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (!openai || items.length === 0) return result;

  const toProcess = items.filter(({ raw, category }) => {
    const key = `${raw}|${category}`;
    if (cache.has(key)) {
      result.set(merchantLlmResultKey(raw, category), cache.get(key)!);
      return false;
    }
    return needsLLMNormalization(raw, category);
  });
  if (toProcess.length === 0) return result;

  if (Date.now() < openAiCooldownUntil) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[merchant-normalize-llm] skipping LLM (cooldown after OpenAI 429; use rule-based names only)"
      );
    }
    return result;
  }

  const capped = toProcess.slice(0, MAX_LLM_ITEMS_PER_REQUEST);
  if (capped.length < toProcess.length && process.env.NODE_ENV !== "production") {
    console.warn(
      `[merchant-normalize-llm] batch capped: ${capped.length}/${toProcess.length} (max ${MAX_LLM_ITEMS_PER_REQUEST} per request; remainder on later loads via DB)`
    );
  }

  const inputs = capped.map(({ raw, category }) => ({ raw, category }));

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
    for (let i = 0; i < capped.length && i < arr.length; i++) {
      const { raw, category } = capped[i];
      const normalized = String(arr[i] ?? raw).slice(0, 80).trim() || raw;
      result.set(merchantLlmResultKey(raw, category), normalized);
      cache.set(`${raw}|${category}`, normalized);
    }
  } catch (e) {
    if (isOpenAiRateLimitError(e)) {
      let retrySec = 75;
      if (e && typeof e === "object" && "message" in e) {
        const m = String((e as { message?: string }).message ?? "");
        const match = m.match(/try again in ([\d.]+)\s*s/i);
        if (match) {
          const s = parseFloat(match[1]);
          if (Number.isFinite(s)) retrySec = Math.min(120, Math.max(20, Math.ceil(s) + 5));
        }
      }
      openAiCooldownUntil = Date.now() + retrySec * 1000;
      console.warn(
        `[merchant-normalize-llm] OpenAI 429 — pausing merchant LLM ~${retrySec}s`
      );
    } else {
      console.warn("[merchant-normalize-llm] LLM failed:", e);
    }
  }
  return result;
}
