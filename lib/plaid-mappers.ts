/**
 * Map Plaid Transaction to our UI Transaction shape.
 */
import type { Transaction as PlaidTransaction } from "plaid";

const CATEGORY_COLORS: Record<string, string> = {
  ENTERTAINMENT: "bg-purple-100 text-purple-700",
  RESTAURANTS: "bg-orange-100 text-orange-700",
  GROCERIES: "bg-emerald-100 text-emerald-700",
  TRAVEL: "bg-cyan-100 text-cyan-700",
  TRANSPORTATION: "bg-blue-100 text-blue-700",
  SHOPPING: "bg-amber-100 text-amber-700",
  UTILITIES: "bg-gray-100 text-gray-700",
  HEALTHCARE: "bg-pink-100 text-pink-700",
  FITNESS: "bg-pink-100 text-pink-700",
  SUBSCRIPTIONS: "bg-purple-100 text-purple-700",
  PERSONAL_CARE: "bg-indigo-100 text-indigo-700",
  GENERAL_MERCHANDISE: "bg-amber-100 text-amber-700",
  GENERAL_SERVICES: "bg-slate-100 text-slate-700",
  FOOD_AND_DRINK: "bg-orange-100 text-orange-700",
  HOME_IMPROVEMENT: "bg-teal-100 text-teal-700",
  RENT_AND_UTILITIES: "bg-gray-100 text-gray-700",
};

const MERCHANT_COLORS = [
  "#E50914", "#1DB954", "#00674B", "#FF9900", "#003366", "#7BB848", "#555555",
  "#4A6CF7", "#E8507A", "#F59E0B", "#10A37F", "#FF5A5F", "#1A1A1A", "#4A90D9",
];

function hashToColor(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h << 5) - h + str.charCodeAt(i);
  return MERCHANT_COLORS[Math.abs(h) % MERCHANT_COLORS.length];
}

function formatDateStr(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

export interface UICategory {
  categoryColor: string;
  category: string;
}

function getCategoryInfo(tx: PlaidTransaction): UICategory {
  const primary = tx.personal_finance_category?.primary ?? tx.category?.[0] ?? "OTHER";
  const category = primary.replace(/_/g, " ");
  const categoryColor = CATEGORY_COLORS[primary] ?? "bg-gray-100 text-gray-700";
  return { category, categoryColor };
}

export interface UITransaction {
  id: string;
  merchant: string;
  rawDescription: string;
  amount: number;
  category: string;
  categoryColor: string;
  date: string;
  dateStr: string;
  isRecurring: boolean;
  hasSplitSuggestion: boolean;
  merchantColor: string;
  location?: string;
}

export function plaidTransactionToUI(tx: PlaidTransaction): UITransaction {
  const { category, categoryColor } = getCategoryInfo(tx);
  const merchant = tx.merchant_name ?? tx.name ?? "Unknown";
  const rawDescription = tx.original_description ?? tx.name ?? "";
  // Plaid: positive = money out, negative = money in. Our UI uses negative for outflows.
  const amount = tx.amount > 0 ? -Math.abs(tx.amount) : Math.abs(tx.amount);
  const location = tx.location?.city && tx.location?.region
    ? `${tx.location.city}, ${tx.location.region}`
    : undefined;

  return {
    id: tx.transaction_id,
    merchant,
    rawDescription,
    amount,
    category,
    categoryColor,
    date: tx.date,
    dateStr: formatDateStr(tx.date),
    isRecurring: false,
    hasSplitSuggestion: false,
    merchantColor: hashToColor(merchant),
    location,
  };
}
