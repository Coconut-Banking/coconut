import { describe, it, expect } from "vitest";
import { centsToMajor, pickBalanceAmount, sumSettlementAmounts } from "../stripe-wallet";

describe("stripe-wallet helpers", () => {
  it("converts cents to major units", () => {
    expect(centsToMajor(1250)).toBe(12.5);
  });

  it("sums settlements in requested currency", () => {
    const total = sumSettlementAmounts(
      [
        { amount: 10, iso_currency_code: "USD" },
        { amount: 5, iso_currency_code: "USD" },
        { amount: 100, iso_currency_code: "CAD" },
      ],
      "USD"
    );
    expect(total).toBe(15);
  });

  it("picks preferred currency from Stripe balance buckets", () => {
    const picked = pickBalanceAmount(
      [
        { amount: 500, currency: "cad" },
        { amount: 2000, currency: "usd" },
      ],
      "usd"
    );
    expect(picked.amount).toBe(20);
    expect(picked.currency).toBe("usd");
  });
});
