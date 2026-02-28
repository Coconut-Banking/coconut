/**
 * Natural language query parser for transactions.
 * No LLM, no API — regex + date math. Client-safe.
 */

interface TransactionLike {
  merchant: string;
  category: string;
  rawDescription: string;
  date: string; // YYYY-MM-DD
  amount: number;
  isRecurring?: boolean;
}

export interface QueryFilters {
  keywords: string[];
  dateStart?: string; // YYYY-MM-DD
  dateEnd?: string;
  amountMin?: number;
  amountMax?: number;
  categoryHint?: string;
}

const STOP_WORDS = new Set([
  "a", "an", "the", "find", "that", "from", "in", "on", "my", "me", "to", "for",
  "and", "or", "with", "by", "at", "of", "all", "show", "get", "search", "transactions",
]);

const MONTH_NAMES: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9,
  october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};

const CATEGORY_SYNONYMS: Record<string, string[]> = {
  entertainment: ["entertainment", "netflix", "spotify", "hulu", "movies", "streaming"],
  dining: ["dining", "dinner", "lunch", "restaurant", "food", "coffee", "cafe", "uber eats", "doordash"],
  groceries: ["groceries", "grocery", "whole foods", "trader joe", "safeway"],
  transport: ["transport", "uber", "lyft", "gas", "parking", "transit"],
  shopping: ["shopping", "amazon", "store"],
  subscriptions: ["subscriptions", "subscription", "recurring", "monthly"],
  travel: ["travel", "flight", "hotel"],
};

function extractKeywords(q: string): string[] {
  const words = q
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));
  return [...new Set(words)];
}

function extractAmountRange(q: string): { min?: number; max?: number } {
  const result: { min?: number; max?: number } = {};
  const lower = q.toLowerCase();
  const overMatch = lower.match(/(?:over|above|more than|>\s*)\$?(\d+(?:\.\d+)?)/);
  const underMatch = lower.match(/(?:under|below|less than|<\s*)\$?(\d+(?:\.\d+)?)/);
  if (overMatch) result.min = parseFloat(overMatch[1]);
  if (underMatch) result.max = parseFloat(underMatch[1]);
  const exactMatch = lower.match(/\$(\d+(?:\.\d+)?)/);
  if (exactMatch && !result.min && !result.max) {
    const n = parseFloat(exactMatch[1]);
    result.min = n;
    result.max = n;
  }
  return result;
}

function extractDateRange(q: string): { start?: string; end?: string } {
  const now = new Date();
  const lower = q.toLowerCase();
  let start: Date | undefined;
  let end: Date | undefined;

  // "last month"
  if (/\blast month\b/.test(lower)) {
    start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    end = new Date(now.getFullYear(), now.getMonth(), 0);
  }
  // "this month"
  else if (/\bthis month\b/.test(lower)) {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end = new Date();
  }
  // "last week" / "this week"
  else if (/\blast week\b/.test(lower)) {
    const copy = new Date(now);
    const day = copy.getDay();
    const diff = copy.getDate() - day - 7;
    start = new Date(copy.getFullYear(), copy.getMonth(), diff);
    end = new Date(start);
    end.setDate(end.getDate() + 6);
  }
  else if (/\bthis week\b/.test(lower)) {
    const copy = new Date(now);
    const day = copy.getDay();
    const diff = copy.getDate() - day;
    start = new Date(copy.getFullYear(), copy.getMonth(), diff);
    end = new Date(now);
  }
  // "January" / "in January" / "January 2026"
  else {
    for (const [name, month] of Object.entries(MONTH_NAMES)) {
      const re = new RegExp(`\\b${name}\\b(?:\\s+(\\d{4}))?`, "i");
      const m = lower.match(re);
      if (m) {
        const year = m[1] ? parseInt(m[1], 10) : now.getFullYear();
        start = new Date(year, month - 1, 1);
        end = new Date(year, month, 0);
        break;
      }
    }
  }

  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return {
    start: start ? fmt(start) : undefined,
    end: end ? fmt(end) : undefined,
  };
}

function extractCategoryHint(q: string): string | undefined {
  const lower = q.toLowerCase();
  for (const [category, synonyms] of Object.entries(CATEGORY_SYNONYMS)) {
    if (synonyms.some((s) => lower.includes(s))) {
      return category;
    }
  }
  return undefined;
}

export function parseQuery(query: string): QueryFilters {
  const q = query.trim();
  if (!q) return { keywords: [] };

  const keywords = extractKeywords(q);
  const { min: amountMin, max: amountMax } = extractAmountRange(q);
  const { start: dateStart, end: dateEnd } = extractDateRange(q);
  const categoryHint = extractCategoryHint(q);

  return {
    keywords,
    dateStart,
    dateEnd,
    amountMin,
    amountMax,
    categoryHint,
  };
}

export function filterTransactions<T extends TransactionLike>(
  transactions: T[],
  filters: QueryFilters
): T[] {
  if (filters.keywords.length === 0 && !filters.dateStart && !filters.dateEnd && filters.amountMin == null && filters.amountMax == null && !filters.categoryHint) {
    return transactions;
  }

  return transactions.filter((tx) => {
    const text = [tx.merchant, tx.category, tx.rawDescription].join(" ").toLowerCase();

    if (filters.keywords.length > 0) {
      const matchCount = filters.keywords.filter((kw) => text.includes(kw)).length;
      if (matchCount === 0) return false;
    }

    if (filters.dateStart && tx.date < filters.dateStart) return false;
    if (filters.dateEnd && tx.date > filters.dateEnd) return false;

    const absAmount = Math.abs(tx.amount);
    if (filters.amountMin != null && absAmount < filters.amountMin) return false;
    if (filters.amountMax != null && absAmount > filters.amountMax) return false;

    if (filters.categoryHint) {
      const catLower = tx.category.toLowerCase();
      const hint = filters.categoryHint.toLowerCase().replace(/\s+/g, " ");
      const catMatch = catLower.includes(hint) || hint.split(" ").some((word) => catLower.includes(word));
      // Map common hints to Plaid categories: "food and drink" matches FOOD_AND_DRINK, RESTAURANTS, GROCERIES
      const foodMatch = ["food and drink", "food", "dining", "restaurant"].some((h) => hint.includes(h)) &&
        ["food", "drink", "restaurant", "groceries"].some((c) => catLower.includes(c));
      const recurringMatch = filters.categoryHint === "subscriptions" && tx.isRecurring;
      if (!catMatch && !foodMatch && !recurringMatch) return false;
    }

    return true;
  });
}

/**
 * One-liner: parse + filter.
 */
export function searchTransactionsNL<T extends TransactionLike>(
  transactions: T[],
  query: string
): T[] {
  const filters = parseQuery(query);
  return filterTransactions(transactions, filters);
}
