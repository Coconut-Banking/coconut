/**
 * Tests for BUG-CRITICAL-3 (5th regression):
 *   Subscription amounts on the subscriptions page must be converted from USD
 *   to the user's display currency before formatting.
 *
 * These tests verify that `convertCurrency` produces the correct converted
 * values that the page now passes to `fc()` and `fca()`.  They fail against
 * the old code (no conversion) and pass with the fix.
 */
import { describe, it, expect } from "vitest";
import { convertCurrency, formatCurrency, formatCurrencyAbs } from "@/lib/currency";

// ── Helpers that mirror the page's rendering logic ───────────────────────────

/** Simulates what the page now does: convert from USD then format. */
function displayAmount(amountUsd: number, currencyCode: string): string {
  return formatCurrency(convertCurrency(amountUsd, "USD", currencyCode), currencyCode);
}

/** Simulates what the page now does for abs amounts (fca). */
function displayAmountAbs(amountUsd: number, currencyCode: string): string {
  return formatCurrencyAbs(convertCurrency(amountUsd, "USD", currencyCode), currencyCode);
}

// ── convertCurrency correctness (core of the bug fix) ────────────────────────

describe("convertCurrency – USD → display currency", () => {
  it("returns the same amount when from and to are both USD", () => {
    expect(convertCurrency(12.99, "USD", "USD")).toBeCloseTo(12.99, 5);
  });

  it("converts USD → EUR using the expected rate (1 USD = 1/1.08 EUR)", () => {
    // RATES_TO_USD: EUR=1.08, so 12.99 USD → 12.99/1.08 EUR ≈ 12.0278
    const converted = convertCurrency(12.99, "USD", "EUR");
    expect(converted).toBeCloseTo(12.99 / 1.08, 4);
    // Must NOT equal the raw USD amount
    expect(converted).not.toBeCloseTo(12.99, 2);
  });

  it("converts USD → GBP using the expected rate", () => {
    // RATES_TO_USD: GBP=1.27
    const converted = convertCurrency(12.99, "USD", "GBP");
    expect(converted).toBeCloseTo(12.99 / 1.27, 4);
    expect(converted).not.toBeCloseTo(12.99, 2);
  });

  it("converts USD → CAD using the expected rate", () => {
    // RATES_TO_USD: CAD=0.74
    const converted = convertCurrency(100, "USD", "CAD");
    expect(converted).toBeCloseTo(100 / 0.74, 4);
    expect(converted).toBeGreaterThan(100); // CAD is weaker than USD
  });

  it("totalMonthly conversion: EUR user sees more than raw USD cents but not same symbol", () => {
    const totalMonthlyUsd = 50.0;
    const converted = convertCurrency(totalMonthlyUsd, "USD", "EUR");
    // 50 USD → ~46.30 EUR (50/1.08)
    expect(converted).toBeCloseTo(50 / 1.08, 3);
    expect(converted).toBeLessThan(totalMonthlyUsd); // EUR is stronger
  });

  it("totalAnnual conversion: GBP user sees correct annual amount", () => {
    const totalAnnualUsd = 600.0;
    const converted = convertCurrency(totalAnnualUsd, "USD", "GBP");
    expect(converted).toBeCloseTo(600 / 1.27, 3);
    expect(converted).toBeLessThan(totalAnnualUsd);
  });
});

// ── Display formatting — the bug: wrong symbol with unconverted amount ────────

describe("BUG-CRITICAL-3: subscriptions page shows correct converted amounts", () => {
  it("EUR user: totalMonthly formats with € and converted value (NOT raw $12.99)", () => {
    const rawUsd = 12.99;
    const result = displayAmount(rawUsd, "EUR");
    expect(result).toContain("€");
    // EUR-formatted value should NOT be "€12.99" — it should be ~€12.03
    expect(result).not.toBe("€12.99");
    // The converted amount is 12.99/1.08 ≈ 12.03
    expect(result).toContain("12,03"); // de-DE locale uses comma decimal
  });

  it("GBP user: totalMonthly formats with £ and converted value", () => {
    const rawUsd = 12.99;
    const result = displayAmount(rawUsd, "GBP");
    expect(result).toContain("£");
    expect(result).not.toBe("£12.99");
    // 12.99/1.27 ≈ 10.23
    expect(result).toContain("10.23");
  });

  it("USD user: totalMonthly formats as-is (no conversion needed)", () => {
    const rawUsd = 12.99;
    const result = displayAmount(rawUsd, "USD");
    expect(result).toBe("$12.99");
  });

  it("EUR user: sub.amount (priceChange.change) formats correctly after conversion", () => {
    const priceChangeUsd = 2.00; // a $2.00 price increase stored in USD
    const result = displayAmountAbs(priceChangeUsd, "EUR");
    expect(result).toContain("€");
    // 2.00 / 1.08 ≈ 1.85
    expect(result).toContain("1,85");
  });

  it("EUR user: yearly breakdown amount formats correctly after conversion", () => {
    const yearlyUsd = 155.88; // 12.99 * 12
    const result = displayAmount(yearlyUsd, "EUR");
    expect(result).toContain("€");
    // 155.88 / 1.08 ≈ 144.33
    const converted = convertCurrency(yearlyUsd, "USD", "EUR");
    expect(converted).toBeCloseTo(144.33, 1);
    expect(result).not.toContain("155");
  });

  it("CAD user: totalAnnual converts to more than raw USD amount (CAD is weaker)", () => {
    const totalAnnualUsd = 200;
    // 200 / 0.74 ≈ 270.27 — more CAD than USD since CAD is weaker
    const converted = convertCurrency(totalAnnualUsd, "USD", "CAD");
    expect(converted).toBeGreaterThan(totalAnnualUsd);
    expect(converted).toBeCloseTo(270.27, 1);
    // The formatted result includes the converted value (not the raw $200)
    const result = displayAmount(totalAnnualUsd, "CAD");
    expect(result).toContain("270");
  });
});
