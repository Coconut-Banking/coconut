/**
 * LLM-based query understanding layer.
 *
 * Decomposes a natural-language search query into:
 *   - structured filters (date range, amount range, pending, transaction type)
 *   - semantic search terms (for embedding + full-text)
 *   - optional explicit merchant name (for fuzzy/exact match)
 *   - query intent (search, aggregate, count)
 */
import OpenAI from "openai";
import type { ParsedQuery } from "./types";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

function today(): string {
  return new Date().toISOString().split("T")[0];
}

function defaultParsedQuery(query: string): ParsedQuery {
  return {
    structured_filters: {},
    semantic_terms: query.trim(),
    intent: "search",
  };
}

function validateParsedQuery(raw: unknown, originalQuery: string): ParsedQuery | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const validIntents = ["search", "aggregate", "count"];
  const intent = validIntents.includes(r.intent as string)
    ? (r.intent as ParsedQuery["intent"])
    : "search";

  const filters: ParsedQuery["structured_filters"] = {};

  if (r.date_start && r.date_end && typeof r.date_start === "string" && typeof r.date_end === "string") {
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (datePattern.test(r.date_start) && datePattern.test(r.date_end)) {
      const start = r.date_start <= r.date_end ? r.date_start : r.date_end;
      const end = r.date_start <= r.date_end ? r.date_end : r.date_start;
      filters.date_range = { start, end };
    }
  }

  if (r.amount_min != null || r.amount_max != null) {
    let min = typeof r.amount_min === "number" ? r.amount_min : undefined;
    let max = typeof r.amount_max === "number" ? r.amount_max : undefined;
    if (min != null && max != null && min > max) {
      [min, max] = [max, min];
    }
    filters.amount_range = {};
    if (min != null) filters.amount_range.min = min;
    if (max != null) filters.amount_range.max = max;
  }

  if (typeof r.is_pending === "boolean") {
    filters.is_pending = r.is_pending;
  }

  const validTxTypes = ["expense", "income", "refund"];
  if (validTxTypes.includes(r.transaction_type as string)) {
    filters.transaction_type = r.transaction_type as ParsedQuery["structured_filters"]["transaction_type"];
  }

  const semanticTerms = typeof r.semantic_terms === "string" && r.semantic_terms.trim()
    ? r.semantic_terms.trim()
    : originalQuery.trim();

  const merchantSearch = typeof r.merchant_search === "string" && r.merchant_search.trim()
    ? r.merchant_search.trim()
    : undefined;

  return {
    structured_filters: filters,
    semantic_terms: semanticTerms,
    merchant_search: merchantSearch,
    intent,
  };
}

export async function parseQuery(query: string): Promise<ParsedQuery> {
  if (!openai) return defaultParsedQuery(query);

  const todayStr = today();

  const prompt = `You are a financial search query parser. Given a user's natural-language query about their bank transactions, extract a structured search intent. Return ONLY valid JSON.

Today's date: ${todayStr}

Output JSON schema:
{
  "date_start": "YYYY-MM-DD or null",
  "date_end": "YYYY-MM-DD or null",
  "amount_min": number or null,
  "amount_max": number or null,
  "is_pending": boolean or null,
  "transaction_type": "expense" | "income" | "refund" | null,
  "semantic_terms": "string — the core concept to search for semantically",
  "merchant_search": "string or null — explicit merchant name if one is mentioned",
  "intent": "search" | "aggregate" | "count"
}

Rules:
- "semantic_terms" should capture WHAT the user is looking for in natural language. It is used for embedding similarity search. Include category concepts, merchant descriptions, and activity types. Example: "coffee shops" not just "coffee".
- "merchant_search" should ONLY be set when the user names a specific brand/merchant (e.g. "Starbucks", "Amazon", "Netflix"). Do NOT set for concepts like "coffee shops" or "groceries".
- Date resolution:
  - "last week" → previous Monday through Sunday
  - "this week" → most recent Monday through today
  - "last month" → previous calendar month (1st to last day)
  - "this month" → 1st of current month through today
  - "last 3 months" / "past 90 days" → 90 days back from today
  - "in January" (no year) → January of the current year (or previous year if we haven't reached January yet)
  - No date mentioned → null (the system will default to all time)
- Amount resolution:
  - "over $50" / "more than $50" → amount_min: -50 (expenses are stored as negative)
  - "under $20" / "less than $20" → amount_max: -20
  - "around $47" / "about $47" → amount_min: -49, amount_max: -45
  - Amounts are stored negative for expenses. For expense queries, negate the amount thresholds.
- "intent":
  - "search" → user wants to find/list matching transactions
  - "aggregate" → user wants a total/sum (e.g. "how much did I spend on...")
  - "count" → user wants to know how many (e.g. "how many times did I...")

Examples:
- "Starbucks last week" → { date_start: "...", date_end: "...", semantic_terms: "Starbucks coffee", merchant_search: "Starbucks", intent: "search" }
- "how much did I spend on food this month" → { date_start: "...", date_end: "...", semantic_terms: "food dining restaurants", intent: "aggregate" }
- "Amazon purchases over $50" → { amount_min: -50, semantic_terms: "Amazon purchases shopping", merchant_search: "Amazon", intent: "search" }
- "coffee shops" → { semantic_terms: "coffee shops cafe", intent: "search" }
- "that $47 uber ride" → { amount_min: -49, amount_max: -45, semantic_terms: "uber ride transportation", merchant_search: "uber", intent: "search" }
- "subscriptions" → { semantic_terms: "subscriptions recurring monthly payments streaming", intent: "search" }
- "refunds" → { semantic_terms: "refunds credits returns", transaction_type: "refund", intent: "search" }

User query: "${query.trim()}"`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 500,
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) return defaultParsedQuery(query);

    const parsed = validateParsedQuery(JSON.parse(raw), query);
    return parsed ?? defaultParsedQuery(query);
  } catch (e) {
    console.warn("[search-v2/query-parser] extraction failed:", e);
    return defaultParsedQuery(query);
  }
}
