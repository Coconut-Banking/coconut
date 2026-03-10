/**
 * Centralized currency formatting. Default is USD.
 * When we add user currency preferences, update DEFAULT_CURRENCY
 * and the format function will adapt automatically.
 */

export const DEFAULT_CURRENCY = "usd";
export const DEFAULT_CURRENCY_CODE = "USD";
export const DEFAULT_LOCALE = "en-US";

const formatter = new Intl.NumberFormat(DEFAULT_LOCALE, {
  style: "currency",
  currency: DEFAULT_CURRENCY_CODE,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Format a number as currency (e.g. $12.99). Uses locale-aware formatting. */
export function formatCurrency(amount: number): string {
  return formatter.format(amount);
}

/** Format an absolute amount without sign (e.g. "$12.99") */
export function formatCurrencyAbs(amount: number): string {
  return formatter.format(Math.abs(amount));
}
