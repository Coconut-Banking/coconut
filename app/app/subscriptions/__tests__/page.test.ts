/**
 * Tests for BUG-CLIENT-1: Subscriptions page displays USD amounts without currency conversion
 *
 * The React component itself cannot be unit-tested in isolation because it
 * requires Clerk auth context, custom hooks, and Next.js infrastructure.
 *
 * Instead, these tests validate the pure utility layer used by the fix:
 *   - formatCurrency alone does NOT convert currencies (it only formats)
 *   - convertCurrency produces the correct target-currency numeric value
 *   - the combined pattern (convertCurrency → formatCurrency) produces the
 *     correct display string for a non-USD user
 *
 * Bug-ID: BUG-CLIENT-1
 * Severity: P2
 */

import { describe, it, expect } from "vitest";
import { formatCurrency, formatCurrencyAbs, convertCurrency } from "@/lib/currency";

// EUR rate: 1 EUR = 1.08 USD, so 1 USD = 1/1.08 EUR ≈ 0.9259 EUR
// $15.99 USD → 15.99 / 1.08 ≈ 14.8056 EUR
const USD_AMOUNT = 15.99;
const EUR_RATE_TO_USD = 1.08;
const EXPECTED_EUR = USD_AMOUNT / EUR_RATE_TO_USD; // ≈ 14.81

describe("BUG-CLIENT-1: subscriptions page currency conversion", () => {
  it("formatCurrency alone does NOT convert — it formats the raw number with a different symbol", () => {
    // Before the fix, the page called fc(amount) without convertCurrency.
    // For a EUR user, fc() calls formatCurrency(amount, "EUR") which formats
    // the USD numeric value with the EUR symbol — no conversion.
    const buggyOutput = formatCurrency(USD_AMOUNT, "EUR");
    // The buggy output shows the USD numeric value (15.99) with EUR symbol.
    // It must NOT equal the correctly converted EUR display.
    const correctOutput = formatCurrency(EXPECTED_EUR, "EUR");
    expect(buggyOutput).not.toBe(correctOutput);
  });

  it("convertCurrency converts USD to EUR correctly", () => {
    const result = convertCurrency(USD_AMOUNT, "USD", "EUR");
    // 15.99 / 1.08 ≈ 14.8056
    expect(result).toBeCloseTo(EXPECTED_EUR, 2);
  });

  it("convertCurrency is a no-op when source and target are the same", () => {
    const result = convertCurrency(USD_AMOUNT, "USD", "USD");
    expect(result).toBe(USD_AMOUNT);
  });

  it("combined pattern (convertCurrency then formatCurrency) produces correct EUR display string", () => {
    const converted = convertCurrency(USD_AMOUNT, "USD", "EUR");
    const displayed = formatCurrency(converted, "EUR");
    // The correctly converted and formatted EUR amount should NOT contain $15.99
    expect(displayed).not.toContain("15,99");
    // It should represent the converted value (~14.81)
    expect(displayed).toContain("14,8");
  });

  it("formatCurrencyAbs without conversion shows wrong value for non-USD users", () => {
    // Before fix: fca(sub.amount) with EUR user shows $15.99 formatted as EUR
    const buggyOutput = formatCurrencyAbs(USD_AMOUNT, "EUR");
    const correctOutput = formatCurrencyAbs(convertCurrency(USD_AMOUNT, "USD", "EUR"), "EUR");
    expect(buggyOutput).not.toBe(correctOutput);
  });

  it("combined pattern with formatCurrencyAbs produces correct EUR absolute display", () => {
    const converted = convertCurrency(USD_AMOUNT, "USD", "EUR");
    const displayed = formatCurrencyAbs(converted, "EUR");
    expect(displayed).toContain("14,8");
  });
});
