/**
 * Tests for BUG-SUBS-1: Subscriptions page displays wrong numeric values for non-USD users.
 *
 * Subscription amounts are stored in USD. `useCurrency().format` (fc) only formats
 * with the user's locale and symbol — it does NOT convert currencies. Without
 * `convertCurrency(amount, "USD", currencyCode)`, a EUR user with a $15.99/month
 * subscription sees "€15,99" (wrong USD value, wrong symbol) instead of the
 * correct "€14,81".
 *
 * The React component itself cannot be unit-tested in isolation because it requires
 * Clerk auth context, custom hooks, and Next.js infrastructure. However, the buggy
 * pattern is entirely in the pure utility layer:
 *   - `formatCurrency(amount, "EUR")` formats a USD amount with the EUR symbol
 *     without converting — this is the bug.
 *   - `formatCurrency(convertCurrency(amount, "USD", "EUR"), "EUR")` first converts
 *     to EUR, then formats — this is the fix.
 *
 * These tests verify:
 *   1. formatCurrency alone does NOT convert (it only labels the amount).
 *   2. convertCurrency produces a different (correct) value for non-USD amounts.
 *   3. The combined pattern (convert then format) produces the correct display string.
 */

import { describe, it, expect } from "vitest";
import { formatCurrency, formatCurrencyAbs, convertCurrency } from "@/lib/currency";

describe("BUG-SUBS-1: subscription amount display for non-USD users", () => {
  const USD_AMOUNT = 15.99; // stored subscription price in USD

  it("formatCurrency alone does not convert — bug: EUR user sees USD value with EUR symbol", () => {
    // Without convertCurrency, the raw USD amount is formatted with the EUR symbol.
    // This is exactly what the old code did: fc(sub.amount) where fc = useCurrency().format
    // bound to "EUR". The numeric value is unchanged — only the symbol is wrong.
    const buggyOutput = formatCurrency(USD_AMOUNT, "EUR");

    // The numeric value is still the USD amount (15.99), just labeled as EUR.
    // A correct EUR conversion of $15.99 at 1 USD = ~0.926 EUR would be ≈14.81 EUR,
    // which is a different number. The buggy output must NOT equal a correct conversion.
    const correctEurAmount = convertCurrency(USD_AMOUNT, "USD", "EUR");
    expect(correctEurAmount).not.toBeCloseTo(USD_AMOUNT, 1); // conversion changes the value
    expect(buggyOutput).not.toEqual(formatCurrency(correctEurAmount, "EUR"));
  });

  it("convertCurrency(amount, 'USD', 'EUR') produces a smaller value than the USD amount", () => {
    // 1 USD < 1 EUR in purchasing power, so a USD amount converts to a smaller EUR number.
    // EUR rate to USD = 1.08 (per lib/currency.ts), so $15.99 USD = 15.99 / 1.08 ≈ 14.81 EUR.
    const eurAmount = convertCurrency(USD_AMOUNT, "USD", "EUR");
    expect(eurAmount).toBeCloseTo(14.81, 1);
    expect(eurAmount).toBeLessThan(USD_AMOUNT);
  });

  it("correct pattern: convertCurrency then format produces the right display string for EUR", () => {
    // This is what the fixed code does at all 6 display sites:
    //   fc(convertCurrency(amount, "USD", currencyCode))
    const eurAmount = convertCurrency(USD_AMOUNT, "USD", "EUR");
    const displayed = formatCurrency(eurAmount, "EUR");

    // Should contain the euro sign and reflect the converted (smaller) number.
    expect(displayed).toContain("€");
    // The EUR-formatted string should NOT contain "15,99" or "15.99" — the raw USD amount.
    expect(displayed).not.toMatch(/15[,.]99/);
    // It should contain approximately 14.81 (the converted value).
    expect(displayed).toMatch(/14[,.]8/);
  });

  it("formatCurrencyAbs conversion is also correct for price-change badge (sub.priceChange.change)", () => {
    // fca(convertCurrency(sub.priceChange.change, "USD", currencyCode)) — fixed pattern
    const priceChange = 2.0; // $2 USD price increase
    const converted = convertCurrency(priceChange, "USD", "EUR");
    const displayed = formatCurrencyAbs(converted, "EUR");

    // Should be less than $2 when converted to EUR
    expect(converted).toBeLessThan(priceChange);
    expect(displayed).toContain("€");
  });
});
