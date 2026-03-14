/**
 * Centralized currency formatting.
 * Supports user-selectable currency preference via the useCurrency hook.
 */

export const DEFAULT_CURRENCY = "usd";
export const DEFAULT_CURRENCY_CODE = "USD";
export const DEFAULT_LOCALE = "en-US";

/** Top 10 currencies with their display info. */
export const SUPPORTED_CURRENCIES = [
  { code: "USD", name: "US Dollar", symbol: "$", locale: "en-US" },
  { code: "CAD", name: "Canadian Dollar", symbol: "C$", locale: "en-CA" },
  { code: "EUR", name: "Euro", symbol: "\u20AC", locale: "de-DE" },
  { code: "GBP", name: "British Pound", symbol: "\u00A3", locale: "en-GB" },
  { code: "JPY", name: "Japanese Yen", symbol: "\u00A5", locale: "ja-JP" },
  { code: "AUD", name: "Australian Dollar", symbol: "A$", locale: "en-AU" },
  { code: "CHF", name: "Swiss Franc", symbol: "CHF", locale: "de-CH" },
  { code: "CNY", name: "Chinese Yuan", symbol: "\u00A5", locale: "zh-CN" },
  { code: "INR", name: "Indian Rupee", symbol: "\u20B9", locale: "en-IN" },
  { code: "MXN", name: "Mexican Peso", symbol: "MX$", locale: "es-MX" },
] as const;

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number]["code"];

/** Cache formatters per currency to avoid recreating them */
const formatterCache = new Map<string, Intl.NumberFormat>();

function getFormatter(currencyCode: string): Intl.NumberFormat {
  const cached = formatterCache.get(currencyCode);
  if (cached) return cached;

  const info = SUPPORTED_CURRENCIES.find((c) => c.code === currencyCode);
  const locale = info?.locale ?? DEFAULT_LOCALE;
  const fmt = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: currencyCode === "JPY" ? 0 : 2,
    maximumFractionDigits: currencyCode === "JPY" ? 0 : 2,
  });
  formatterCache.set(currencyCode, fmt);
  return fmt;
}

/** Format a number as currency (e.g. $12.99, C$12.99, etc.). */
export function formatCurrency(amount: number, currencyCode: string = DEFAULT_CURRENCY_CODE): string {
  return getFormatter(currencyCode).format(amount);
}

/** Format an absolute amount without sign (e.g. "$12.99") */
export function formatCurrencyAbs(amount: number, currencyCode: string = DEFAULT_CURRENCY_CODE): string {
  return getFormatter(currencyCode).format(Math.abs(amount));
}

/** Get the currency symbol for a code */
export function getCurrencySymbol(currencyCode: string = DEFAULT_CURRENCY_CODE): string {
  const info = SUPPORTED_CURRENCIES.find((c) => c.code === currencyCode);
  return info?.symbol ?? "$";
}

/** Static rates to USD (1 unit of currency = X USD). Approximate for display conversion. */
const RATES_TO_USD: Record<string, number> = {
  USD: 1,
  CAD: 0.74,
  EUR: 1.08,
  GBP: 1.27,
  JPY: 0.0067,
  AUD: 0.65,
  CHF: 1.12,
  CNY: 0.14,
  INR: 0.012,
  MXN: 0.058,
};

/** Convert amount from source currency to display currency. Returns original amount if conversion not available. */
export function convertCurrency(
  amount: number,
  fromCurrency: string,
  toCurrency: string
): number {
  const from = (fromCurrency || "USD").toUpperCase();
  const to = (toCurrency || "USD").toUpperCase();
  if (from === to) return amount;
  const fromRate = RATES_TO_USD[from] ?? 1;
  const toRate = RATES_TO_USD[to] ?? 1;
  const usdAmount = amount * fromRate;
  return usdAmount / toRate;
}
