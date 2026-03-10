import { describe, it, expect } from "vitest";

/** Mirror of filter logic: plaid_transaction_id starting with manual_ = manual expense (Shared), not bank */
function isManualTransaction(plaidTransactionId: string | null | undefined): boolean {
  return String(plaidTransactionId || "").startsWith("manual_");
}

describe("isManualTransaction", () => {
  it("returns true for manual expense IDs", () => {
    expect(isManualTransaction("manual_abc-123")).toBe(true);
    expect(isManualTransaction("manual_")).toBe(true);
  });

  it("returns false for bank/Plaid transaction IDs", () => {
    expect(isManualTransaction("txn_plaid_123")).toBe(false);
    expect(isManualTransaction("abc-def-123")).toBe(false);
    expect(isManualTransaction("")).toBe(false);
  });

  it("returns false for null/undefined", () => {
    expect(isManualTransaction(null)).toBe(false);
    expect(isManualTransaction(undefined)).toBe(false);
  });
});

describe("transaction filtering (bankOnly)", () => {
  it("filters out manual_ transactions for main Transactions page", () => {
    const all = [
      { plaid_transaction_id: "plaid_1" },
      { plaid_transaction_id: "manual_xyz" },
      { plaid_transaction_id: "plaid_2" },
    ];
    const bankOnly = all.filter((tx) => !isManualTransaction(tx.plaid_transaction_id));
    expect(bankOnly).toHaveLength(2);
    expect(bankOnly.map((t) => t.plaid_transaction_id)).toEqual(["plaid_1", "plaid_2"]);
  });
});
