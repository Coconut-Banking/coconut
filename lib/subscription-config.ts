/**
 * Subscription vs bill classification.
 * Exclude bills (rent, utilities, transfers, etc.) from auto-detection.
 * @see docs/SUBSCRIPTIONS_PLAN.md
 */

/** Plaid primary_category values to exclude — these are bills, not cancellable subscriptions. */
export const BILL_CATEGORIES = new Set([
  "RENT_AND_UTILITIES",
  "LOAN_PAYMENTS",
  "MORTGAGE_PAYMENTS",
  "INSURANCE_PREMIUMS",
  "BANK_FEES",
  "INTEREST",
  "INCOME",
  "TRANSFER",
  "TRANSFER_OUT",
  "LOANS_AND_MORTGAGES",
  "INVESTMENT",
]);

/** Merchant/raw_name substrings (case-insensitive) — exclude if any match. */
export const BILL_MERCHANT_PATTERNS = [
  "rent",
  "apartment",
  "landlord",
  "property management",
  "mortgage",
  "home loan",
  "escrow",
  "electric",
  "gas utility",
  "natural gas",
  "water",
  "sewer",
  "trash",
  "utility",
  "power utility",
  "power company",
  "xcel",
  "pge",
  "comed",
  "duke energy",
  "insurance",
  "geico",
  "state farm",
  "allstate",
  "premium",
  "hoa",
  "homeowners",
  "loan",
  "autopay",
  "thank you", // "AUTOMATIC PAYMENT - THANK"
  "credit card",
  "ach electronic credit", // payroll, income
  "gusto pay",
  "cd deposit", // one-time CD, not a subscription
  "bank transfer",
  "wire transfer",
  "ach transfer",
];

function normalizeCategory(cat: string | null): string {
  if (!cat) return "";
  return cat.toUpperCase().replace(/\s+/g, "_").replace(/-/g, "_");
}

function normalizeForMatch(s: string): string {
  return s.toLowerCase().trim();
}

export function isBillCategory(category: string | null): boolean {
  const norm = normalizeCategory(category);
  if (!norm) return false;
  // Check exact and common variants (Plaid uses both)
  if (BILL_CATEGORIES.has(norm)) return true;
  if (norm.includes("RENT") || norm.includes("UTILITY")) return true;
  if (norm.includes("LOAN") || norm.includes("TRANSFER")) return true;
  if (norm.includes("INCOME")) return true;
  if (norm.includes("INSURANCE") || norm.includes("MORTGAGE")) return true;
  return false;
}

export function isBillMerchant(merchantName: string, rawName: string): boolean {
  const combined = normalizeForMatch(`${merchantName} ${rawName}`);
  return BILL_MERCHANT_PATTERNS.some((p) => combined.includes(p));
}

export function shouldExcludeAsSubscription(
  primaryCategory: string | null,
  merchantName: string,
  rawName: string
): boolean {
  if (isBillCategory(primaryCategory)) return true;
  if (isBillMerchant(merchantName, rawName)) return true;
  return false;
}
