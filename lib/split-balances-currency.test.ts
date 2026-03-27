import { describe, expect, it } from "vitest";
import { computeBalancesByCurrency, normalizeSplitCurrency } from "./split-balances-currency";

describe("normalizeSplitCurrency", () => {
  it("defaults empty to USD", () => {
    expect(normalizeSplitCurrency(null)).toBe("USD");
    expect(normalizeSplitCurrency("")).toBe("USD");
  });
  it("uppercases", () => {
    expect(normalizeSplitCurrency("cad")).toBe("CAD");
  });
});

describe("computeBalancesByCurrency", () => {
  it("does not mix CAD and USD into one member total", () => {
    const paidRows = [
      { member_id: "a", amount: 100, currency: "CAD" },
      { member_id: "a", amount: 50, currency: "USD" },
    ];
    const owedRows = [
      { member_id: "a", amount: 50, currency: "CAD" },
      { member_id: "b", amount: 50, currency: "CAD" },
      { member_id: "a", amount: 25, currency: "USD" },
      { member_id: "b", amount: 25, currency: "USD" },
    ];
    const byCur = computeBalancesByCurrency(paidRows, owedRows, [], []);
    const cad = byCur.get("CAD")!.get("a")!.total;
    const usd = byCur.get("USD")!.get("a")!.total;
    expect(cad).toBe(50);
    expect(usd).toBe(25);
  });
});
