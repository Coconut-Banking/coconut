/**
 * Semantic Transaction Search Engine
 *
 * Flow:
 *   user query
 *     → LLM: extract structured intent (no transaction data shown to LLM)
 *     → SQL builder: parameterized Supabase query
 *     → optional pgvector fallback for fuzzy/unstructured queries
 *     → deterministic aggregation in TS from SQL-filtered rows
 */
import OpenAI from "openai";
import { getSupabase } from "./supabase";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// ─── Intent schema ────────────────────────────────────────────────────────────

export interface SearchIntent {
  metric: "sum" | "count" | "list" | "breakdown" | "top_merchant";
  date_start: string;   // YYYY-MM-DD
  date_end: string;     // YYYY-MM-DD
  merchant: string | null;
  category: string | null;  // Plaid primary category, e.g. FOOD_AND_DRINK
  amount_gt: number | null; // absolute value threshold
  amount_lt: number | null;
}

// ─── Intent extraction ────────────────────────────────────────────────────────

const today = () => new Date().toISOString().split("T")[0];

function defaultIntent(): SearchIntent {
  const end = today();
  const start = new Date();
  start.setDate(start.getDate() - 30);
  return {
    metric: "list",
    date_start: start.toISOString().split("T")[0],
    date_end: end,
    merchant: null,
    category: null,
    amount_gt: null,
    amount_lt: null,
  };
}

function validateIntent(raw: unknown): SearchIntent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const METRICS = ["sum", "count", "list", "breakdown", "top_merchant"];
  if (!METRICS.includes(r.metric as string)) return null;
  if (typeof r.date_start !== "string" || typeof r.date_end !== "string") return null;
  const merchant = typeof r.merchant === "string" && r.merchant.toLowerCase() !== "null"
    ? r.merchant
    : null;
  const category = typeof r.category === "string" && r.category.toLowerCase() !== "null"
    ? r.category
    : null;
  return {
    metric: r.metric as SearchIntent["metric"],
    date_start: r.date_start as string,
    date_end: r.date_end as string,
    merchant,
    category,
    amount_gt: typeof r.amount_gt === "number" ? r.amount_gt : null,
    amount_lt: typeof r.amount_lt === "number" ? r.amount_lt : null,
  };
}

export async function extractIntent(query: string): Promise<SearchIntent> {
  if (!openai) return defaultIntent();

  const todayStr = today();
  const prompt = `You are a financial query parser. Extract a structured search intent from the user's query about their bank transactions. Return ONLY valid JSON matching the schema below. Never explain. Never add fields.

Today: ${todayStr}

Schema:
{
  "metric": "sum | count | list | breakdown | top_merchant",
  "date_start": "YYYY-MM-DD",
  "date_end": "YYYY-MM-DD",
  "merchant": "string or null",
  "category": "PLAID_CATEGORY or null",
  "amount_gt": number or null,
  "amount_lt": number or null
}

metric definitions:
- sum: user wants total amount spent (e.g. "how much did I spend on X")
- count: user wants number of transactions (e.g. "how many times did I go to X")
- list: user wants to see transactions (e.g. "show me my uber rides", "coffee last week")
- breakdown: user wants spending by category (e.g. "spending by category", "where does my money go")
- top_merchant: user wants which merchant/place they visited most in a category (e.g. "which restaurant do I eat the most from", "where do I get coffee most"). Use category for the filter (FOOD_AND_DRINK, GROCERIES, etc). merchant MUST be null for top_merchant.

Plaid primary categories (use exact strings):
FOOD_AND_DRINK, GROCERIES, ENTERTAINMENT, TRAVEL, TRANSPORTATION, GENERAL_MERCHANDISE,
GENERAL_SERVICES, PERSONAL_CARE, HEALTHCARE, RENT_AND_UTILITIES, HOME_IMPROVEMENT,
LOAN_PAYMENTS, INCOME, TRANSFER_IN, TRANSFER_OUT, OTHER

Date rules:
- "last month" → first and last day of previous calendar month
- "this month" → first day of current month to today
- "last week" → Mon–Sun of previous week
- "this week" → Mon of current week to today
- "in January" / "in January 2026" → that full month
- "last 30 days" / "past month" → today minus 30 days to today
- "yesterday" → yesterday only
- "today" → today only
- If no date mentioned → last 30 days

Examples for top_merchant:
- "which restaurant do I eat the most from" → {"metric":"top_merchant","date_start":"...","date_end":"...","merchant":null,"category":"FOOD_AND_DRINK"}
- "where do I get coffee most" → {"metric":"top_merchant","date_start":"...","date_end":"...","merchant":null,"category":"FOOD_AND_DRINK"}

Amount rules:
- "over $50" → amount_gt: 50
- "under $20" → amount_lt: 20
- "between $10 and $50" → amount_gt: 10, amount_lt: 50

User query: "${query.trim()}"`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 200,
    });
    const raw = completion.choices[0]?.message?.content;
    if (!raw) return defaultIntent();
    const parsed = validateIntent(JSON.parse(raw));
    return parsed ?? defaultIntent();
  } catch (e) {
    console.warn("[intent] extraction failed:", e);
    return defaultIntent();
  }
}

// ─── Result types ─────────────────────────────────────────────────────────────

export interface DBTransaction {
  id: string;
  plaid_transaction_id: string;
  merchant_name: string | null;
  raw_name: string | null;
  amount: number;
  date: string;
  primary_category: string | null;
  detailed_category: string | null;
  iso_currency_code: string | null;
  is_pending: boolean;
}

export interface SearchResult {
  metric: SearchIntent["metric"];
  transactions: DBTransaction[];
  total: number | null;       // for sum
  count: number | null;       // for count / sum
  breakdown: { category: string; total: number; count: number }[] | null;
  topMerchants: { merchant: string; count: number }[] | null;  // for top_merchant
  answer: string;
  usedVectorFallback: boolean;
}

// ─── SQL builder ──────────────────────────────────────────────────────────────

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

function applyFilters(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: any,
  intent: SearchIntent,
  clerkUserId: string
) {
  query = query
    .eq("clerk_user_id", clerkUserId)
    .gte("date", intent.date_start)
    .lte("date", intent.date_end);

  if (intent.merchant) {
    query = query.ilike("normalized_merchant", `%${normalize(intent.merchant)}%`);
  }
  if (intent.category) {
    query = query.ilike("primary_category", `%${intent.category.toUpperCase()}%`);
  }
  // Amounts stored as negative for expenses; amount_gt/lt are absolute thresholds
  if (intent.amount_gt !== null) {
    query = query.lte("amount", -intent.amount_gt);
  }
  if (intent.amount_lt !== null) {
    query = query.gte("amount", -intent.amount_lt);
  }
  return query;
}

async function runStructuredQuery(
  clerkUserId: string,
  intent: SearchIntent
): Promise<Omit<SearchResult, "answer" | "usedVectorFallback">> {
  const db = getSupabase();

  if (intent.metric === "top_merchant") {
    const intentForQuery = {
      ...intent,
      merchant: null as string | null,
      category: intent.category ?? "FOOD_AND_DRINK",
    };
    const { data, error } = await applyFilters(
      db.from("transactions").select(
        "id, plaid_transaction_id, merchant_name, raw_name, amount, date, primary_category, detailed_category, iso_currency_code, is_pending"
      ).lt("amount", 0).order("date", { ascending: false }),
      intentForQuery,
      clerkUserId
    );
    if (error) throw error;
    const rows = (data ?? []) as DBTransaction[];
    const byMerchant = new Map<string, number>();
    for (const r of rows) {
      const name = (r.merchant_name || r.raw_name || "Unknown").trim();
      if (!name) continue;
      byMerchant.set(name, (byMerchant.get(name) ?? 0) + 1);
    }
    const sorted = Array.from(byMerchant.entries())
      .map(([merchant, count]) => ({ merchant, count }))
      .sort((a, b) => b.count - a.count);
    const top = sorted[0];
    const ties = sorted.filter((s) => s.count === top?.count);
    return {
      metric: "top_merchant",
      transactions: rows,
      total: null,
      count: rows.length,
      breakdown: null,
      topMerchants: ties.length > 0 ? ties : (top ? [top] : []),
    };
  }

  if (intent.metric === "count") {
    const { data, count, error } = await applyFilters(
      db.from("transactions").select(
        "id, plaid_transaction_id, merchant_name, raw_name, amount, date, primary_category, detailed_category, iso_currency_code, is_pending",
        { count: "exact" }
      ).order("date", { ascending: false }).limit(50),
      intent,
      clerkUserId
    );
    if (error) throw error;
    return { metric: "count", transactions: (data ?? []) as DBTransaction[], total: null, count: count ?? 0, breakdown: null, topMerchants: null };
  }

  if (intent.metric === "sum") {
    const { data, error } = await applyFilters(
      db.from("transactions").select(
        "id, plaid_transaction_id, merchant_name, raw_name, amount, date, primary_category, detailed_category, iso_currency_code, is_pending"
      ).lt("amount", 0).order("date", { ascending: false }),
      intent,
      clerkUserId
    );
    if (error) throw error;
    const rows = (data ?? []) as DBTransaction[];
    const total = rows.reduce((s, r) => s + Math.abs(r.amount), 0);
    return { metric: "sum", transactions: rows, total, count: rows.length, breakdown: null, topMerchants: null };
  }

  if (intent.metric === "breakdown") {
    const { data, error } = await applyFilters(
      db.from("transactions").select(
        "id, plaid_transaction_id, merchant_name, raw_name, amount, date, primary_category, detailed_category, iso_currency_code, is_pending"
      ).lt("amount", 0).order("date", { ascending: false }),
      intent,
      clerkUserId
    );
    if (error) throw error;
    const rows = (data ?? []) as DBTransaction[];
    const map = new Map<string, { total: number; count: number }>();
    for (const r of rows) {
      const cat = r.primary_category ?? "OTHER";
      const existing = map.get(cat) ?? { total: 0, count: 0 };
      map.set(cat, { total: existing.total + Math.abs(r.amount), count: existing.count + 1 });
    }
    const breakdown = Array.from(map.entries())
      .map(([category, v]) => ({ category, ...v }))
      .sort((a, b) => b.total - a.total);
    return { metric: "breakdown", transactions: rows, total: null, count: rows.length, breakdown, topMerchants: null };
  }

  // list
  const { data, error } = await applyFilters(
    db.from("transactions").select(
      "id, plaid_transaction_id, merchant_name, raw_name, amount, date, primary_category, detailed_category, iso_currency_code, is_pending"
    ).order("date", { ascending: false }).limit(50),
    intent,
    clerkUserId
  );
  if (error) throw error;
  return {
    metric: "list",
    transactions: (data ?? []) as DBTransaction[],
    total: null,
    count: (data ?? []).length,
    breakdown: null,
    topMerchants: null,
  };
}

// ─── Vector fallback ──────────────────────────────────────────────────────────

async function runVectorSearch(
  clerkUserId: string,
  query: string,
  intent: SearchIntent
): Promise<DBTransaction[]> {
  if (!openai) return [];

  const db = getSupabase();

  // Embed the query
  const { data: embData } = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: query,
  });
  const queryEmbedding = embData[0].embedding;

  const { data, error } = await db.rpc("vector_search_transactions", {
    p_user_id: clerkUserId,
    p_embedding: JSON.stringify(queryEmbedding),
    p_date_start: intent.date_start,
    p_date_end: intent.date_end,
    p_limit: 20,
  });

  if (error) {
    console.warn("[vector] RPC error:", error.message);
    return [];
  }
  return (data ?? []) as DBTransaction[];
}

// ─── Answer generator ─────────────────────────────────────────────────────────

function fmt(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

function fmtPeriod(intent: SearchIntent): string {
  const s = intent.date_start;
  const e = intent.date_end;
  if (s === e) return `on ${s}`;
  return `between ${s} and ${e}`;
}

function generateAnswer(result: Omit<SearchResult, "answer" | "usedVectorFallback">, intent: SearchIntent): string {
  const period = fmtPeriod(intent);
  const subject = intent.merchant
    ? `at ${intent.merchant}`
    : intent.category
    ? `in ${intent.category.replace(/_/g, " ").toLowerCase()}`
    : "";

  if (result.metric === "top_merchant") {
    const tm = result.topMerchants ?? [];
    if (tm.length === 0) return `No restaurant/food transactions found ${period}.`;
    if (tm.length === 1) return `${tm[0].merchant} (${tm[0].count} visit${tm[0].count === 1 ? "" : "s"})`;
    const names = tm.map((m) => m.merchant).join(", ");
    return `${names} are tied (${tm[0].count} visit${tm[0].count === 1 ? "" : "s"} each)`;
  }
  if (result.metric === "sum") {
    if (!result.count) return `No expenses found ${subject} ${period}.`;
    return `You spent ${fmt(result.total ?? 0)} ${subject} ${period} across ${result.count} transaction${result.count === 1 ? "" : "s"}.`;
  }
  if (result.metric === "count") {
    return `You had ${result.count ?? 0} transaction${result.count === 1 ? "" : "s"} ${subject} ${period}.`;
  }
  if (result.metric === "breakdown") {
    if (!result.breakdown?.length) return `No spending data found ${period}.`;
    const top = result.breakdown.slice(0, 3).map((b) => `${b.category.replace(/_/g, " ").toLowerCase()} (${fmt(b.total)})`).join(", ");
    return `Your top categories ${period}: ${top}.`;
  }
  // list
  if (!result.count) return `No transactions found ${subject} ${period}.`;
  return `Found ${result.count} transaction${result.count === 1 ? "" : "s"} ${subject} ${period}.`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function search(clerkUserId: string, query: string): Promise<SearchResult> {
  const intent = await extractIntent(query);
  const filtersDesc = [
    intent.merchant && `merchant ILIKE '%${normalize(intent.merchant)}%'`,
    intent.category && `primary_category ILIKE '%${intent.category}%'`,
    intent.date_start && intent.date_end && `date ${intent.date_start}..${intent.date_end}`,
    intent.amount_gt != null && `amount <= -${intent.amount_gt}`,
    intent.amount_lt != null && `amount >= -${intent.amount_lt}`,
  ].filter(Boolean).join(", ");
  console.log("[nl-search] query:", JSON.stringify(query), "| intent:", JSON.stringify(intent), "| effective filters:", filtersDesc || "(date range only)");

  const hasStructuredFilters =
    intent.merchant !== null ||
    intent.category !== null ||
    intent.amount_gt !== null ||
    intent.amount_lt !== null;

  try {
    const structured = await runStructuredQuery(clerkUserId, intent);

    // Use vector fallback only when: list query, no structured filters, and results are empty
    const shouldFallback =
      intent.metric === "list" &&
      !hasStructuredFilters &&
      structured.transactions.length === 0;

    if (shouldFallback) {
      const vectorResults = await runVectorSearch(clerkUserId, query, intent);
      if (vectorResults.length > 0) {
        return {
          ...structured,
          transactions: vectorResults,
          count: vectorResults.length,
          answer: generateAnswer({ ...structured, transactions: vectorResults, count: vectorResults.length }, intent),
          usedVectorFallback: true,
        };
      }
    }

    return {
      ...structured,
      answer: generateAnswer(structured, intent),
      usedVectorFallback: false,
    };
  } catch (e) {
    console.error("[search] error:", e);
    return {
      metric: intent.metric,
      transactions: [],
      total: null,
      count: 0,
      breakdown: null,
      topMerchants: null,
      answer: "Search failed. Please try again.",
      usedVectorFallback: false,
    };
  }
}
