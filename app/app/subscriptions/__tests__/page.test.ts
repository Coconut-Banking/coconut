import { describe, it, expect } from "vitest";
import { convertCurrency, formatCurrency } from "@/lib/currency";

describe("BUG-SUBSCRIPTIONS-1: subscription amounts require currency conversion before formatting", () => {
  it("formatCurrency alone does not convert USD amounts to display currency", () => {
    const usdAmount = 15.99;
    const withoutConversion = formatCurrency(usdAmount, "EUR");
    const withConversion = formatCurrency(convertCurrency(usdAmount, "USD", "EUR"), "EUR");
    // Bug: without convertCurrency, the EUR display still shows the raw USD number
    expect(withoutConversion).not.toBe(withConversion);
    // withoutConversion encodes the raw USD numeric value (15.99 → "15,99" in de-DE locale)
    expect(withoutConversion).toContain("15,99");
    // withConversion has a different numeric value after conversion (USD→EUR rate ~0.926)
    expect(withConversion).not.toContain("15,99");
  });

  it("convertCurrency(x, 'USD', 'USD') is a no-op — USD users unaffected", () => {
    const amount = 15.99;
    expect(convertCurrency(amount, "USD", "USD")).toBe(amount);
  });

  it("totalMonthly displayed for non-USD user needs conversion", () => {
    const totalMonthlyUSD = 26.98;
    // Broken: fc(totalMonthly) → displays "$26.98" value as "€26.98"
    const broken = formatCurrency(totalMonthlyUSD, "EUR");
    // Fixed: fc(convertCurrency(totalMonthly, "USD", currencyCode))
    const fixed = formatCurrency(convertCurrency(totalMonthlyUSD, "USD", "EUR"), "EUR");
    expect(broken).not.toBe(fixed);
    // The fixed value is smaller (EUR is stronger than USD at current rates)
    expect(convertCurrency(totalMonthlyUSD, "USD", "EUR")).toBeLessThan(totalMonthlyUSD);
  });
});
