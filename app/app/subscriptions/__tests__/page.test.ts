/**
 * BUG-DAILY-1: Subscription amounts must be converted from USD to the user's
 * display currency before formatting, not just have the currency symbol swapped.
 *
 * The subscriptions page previously called fc(amount) which only changed the
 * symbol (e.g. "$10" → "£10") without converting the numeric value. The fix
 * wraps every amount with convertCurrency(amount, "USD", currencyCode) first,
 * matching the dashboard pattern.
 */

import { describe, it, expect } from "vitest";
import { convertCurrency, formatCurrency } from "@/lib/currency";

describe("BUG-DAILY-1: subscription amount currency conversion", () => {
  it("convertCurrency changes the numeric value when converting USD to GBP", () => {
    const usdAmount = 10;
    const converted = convertCurrency(usdAmount, "USD", "GBP");
    // GBP rate is 1.27 (USD per GBP), so $10 ≈ £7.87
    // The converted value must NOT equal the original amount
    expect(converted).not.toBe(usdAmount);
    // Converted value should be less than 10 (GBP is worth more than USD)
    expect(converted).toBeLessThan(usdAmount);
    // Should be roughly in range of ~7–9 GBP
    expect(converted).toBeGreaterThan(6);
    expect(converted).toBeLessThan(9);
  });

  it("formatCurrency without conversion produces wrong symbol-only substitution for GBP", () => {
    const usdAmount = 10;
    // Bug: just formatting $10 as GBP gives "£10.00" — wrong amount
    const wrongDisplay = formatCurrency(usdAmount, "GBP");
    // Fix: convert first, then format
    const correctDisplay = formatCurrency(convertCurrency(usdAmount, "USD", "GBP"), "GBP");
    // The two results must differ — proving the bug when conversion is skipped
    expect(wrongDisplay).not.toBe(correctDisplay);
    // Wrong path: symbol changed but value is still 10
    expect(wrongDisplay).toBe("£10.00");
    // Correct path: value is converted (~7.87), not 10
    expect(correctDisplay).not.toBe("£10.00");
  });

  it("converting USD to USD is a no-op (same-currency guard)", () => {
    const amount = 42.5;
    expect(convertCurrency(amount, "USD", "USD")).toBe(amount);
  });

  it("converts USD to EUR correctly", () => {
    // EUR rate: 1 EUR = 1.08 USD, so $10 ≈ €9.26
    const converted = convertCurrency(10, "USD", "EUR");
    expect(converted).toBeGreaterThan(8);
    expect(converted).toBeLessThan(11);
    // Must differ from original
    expect(converted).not.toBe(10);
  });

  it("totalMonthly correctly reflects converted value for GBP display", () => {
    // Simulates the page: totalMonthly comes from the API in USD
    const totalMonthlyUSD = 50;
    const converted = convertCurrency(totalMonthlyUSD, "USD", "GBP");
    // The displayed amount must be the converted value, not the raw API value
    expect(converted).not.toBe(totalMonthlyUSD);
    const displayedText = formatCurrency(converted, "GBP");
    // Must NOT be "£50.00" — that was the bug
    expect(displayedText).not.toBe("£50.00");
    // Must be a GBP-formatted amount less than 50
    expect(displayedText).toMatch(/^£/);
    expect(converted).toBeLessThan(50);
  });
});
