/**
 * Tests deduplication logic: same merchant+amount+date should collapse to one.
 */
import { describe, it, expect } from "vitest";

function deduplicateTransactions<
  T extends { merchant_name?: string | null; raw_name?: string | null; amount: number; date: string }
>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter((tx) => {
    const merchant = (tx.merchant_name || tx.raw_name || "").trim().toLowerCase();
    const amount = Number(tx.amount);
    const date = tx.date;
    const key = `${merchant}|${amount}|${date}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

describe("transaction deduplication", () => {
  it("removes duplicate merchant+amount+date", () => {
    const list = [
      {
        plaid_transaction_id: "sandbox_1",
        merchant_name: "Denny's Restaurant #7188",
        raw_name: "Denny's Restaurant #7188",
        amount: -56.53,
        date: "2026-03-07",
      },
      {
        plaid_transaction_id: "prod_1",
        merchant_name: "Denny's Restaurant #7188",
        raw_name: "Denny's Restaurant #7188",
        amount: -56.53,
        date: "2026-03-07",
      },
    ];
    const result = deduplicateTransactions(list);
    expect(result).toHaveLength(1);
    expect(result[0].plaid_transaction_id).toBe("sandbox_1"); // first wins
  });

  it("keeps different amounts on same day", () => {
    const list = [
      { merchant_name: "Denny's", amount: -56.53, raw_name: "", date: "2026-03-07" },
      { merchant_name: "Denny's", amount: -20.00, raw_name: "", date: "2026-03-07" },
    ];
    expect(deduplicateTransactions(list)).toHaveLength(2);
  });

  it("keeps same amount on different days", () => {
    const list = [
      { merchant_name: "Starbucks", amount: -5.50, raw_name: "", date: "2026-03-07" },
      { merchant_name: "Starbucks", amount: -5.50, raw_name: "", date: "2026-03-08" },
    ];
    expect(deduplicateTransactions(list)).toHaveLength(2);
  });
});
