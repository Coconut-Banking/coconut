import { describe, it, expect } from "vitest";
import { convertCurrency, formatCurrency } from "./currency";

describe("convertCurrency", () => {
  it("returns the same amount when currencies are identical", () => {
    expect(convertCurrency(100, "USD", "USD")).toBe(100);
    expect(convertCurrency(50, "EUR", "EUR")).toBe(50);
  });

  it("converts USD to EUR correctly", () => {
    // 100 USD -> USD_in_usd(100 * 1) / EUR_rate(1.08) ≈ 92.59
    const result = convertCurrency(100, "USD", "EUR");
    expect(result).toBeCloseTo(100 / 1.08, 2);
  });

  it("converts EUR to USD correctly", () => {
    // 100 EUR -> EUR_in_usd(100 * 1.08) / USD_rate(1) = 108
    const result = convertCurrency(100, "EUR", "USD");
    expect(result).toBeCloseTo(100 * 1.08, 2);
  });

  it("converts GBP to EUR correctly", () => {
    // 100 GBP -> GBP_in_usd(100 * 1.27) / EUR_rate(1.08) ≈ 117.59
    const result = convertCurrency(100, "GBP", "EUR");
    expect(result).toBeCloseTo((100 * 1.27) / 1.08, 2);
  });

  it("is case-insensitive for currency codes", () => {
    const upper = convertCurrency(100, "USD", "EUR");
    const lower = convertCurrency(100, "usd", "eur");
    expect(upper).toBeCloseTo(lower, 10);
  });

  it("returns original amount for unsupported source currency", () => {
    expect(convertCurrency(100, "XYZ", "USD")).toBe(100);
  });

  it("returns original amount for unsupported target currency", () => {
    expect(convertCurrency(100, "USD", "XYZ")).toBe(100);
  });

  it("handles zero amount", () => {
    expect(convertCurrency(0, "USD", "EUR")).toBe(0);
  });
});

describe("account balance conversion (BUG-DAILY-1)", () => {
  it("converts a USD account balance to EUR for display", () => {
    // A user with EUR preference sees a USD account balance converted
    const usdBalance = 1000;
    const converted = convertCurrency(usdBalance, "USD", "EUR");
    const formatted = formatCurrency(converted, "EUR");
    // Result should be formatted in EUR, not USD
    expect(formatted).toContain("€");
    expect(formatted).not.toContain("$");
  });

  it("does not double-convert when native currency matches user preference", () => {
    // If account is already USD and user prefers USD, balance stays unchanged
    const usdBalance = 1000;
    const converted = convertCurrency(usdBalance, "USD", "USD");
    expect(converted).toBe(1000);
    const formatted = formatCurrency(converted, "USD");
    expect(formatted).toContain("$");
  });

  it("converts CAD account balance to USD for display", () => {
    // 500 CAD -> 500 * 0.74 = 370 USD
    const cadBalance = 500;
    const converted = convertCurrency(cadBalance, "CAD", "USD");
    expect(converted).toBeCloseTo(500 * 0.74, 2);
    const formatted = formatCurrency(converted, "USD");
    expect(formatted).toContain("$");
  });
});
