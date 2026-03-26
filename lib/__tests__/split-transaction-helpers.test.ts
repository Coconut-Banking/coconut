import { describe, expect, it } from "vitest";
import {
  merchantLabelFromSplitRow,
  paidAmountFromSplitRow,
  splitTransactionDedupeKey,
} from "../split-transaction-helpers";

describe("splitTransactionDedupeKey", () => {
  it("uses transaction_id when set", () => {
    expect(
      splitTransactionDedupeKey({ id: "a", transaction_id: "tx-1" })
    ).toBe("tx:tx-1");
  });

  it("uses split id when transaction_id is null (Splitwise rows)", () => {
    expect(splitTransactionDedupeKey({ id: "s1", transaction_id: null })).toBe("split:s1");
    expect(splitTransactionDedupeKey({ id: "s2", transaction_id: undefined })).toBe("split:s2");
  });
});

describe("paidAmountFromSplitRow", () => {
  it("prefers bank transaction amount when non-zero", () => {
    expect(
      paidAmountFromSplitRow({
        transactions: { amount: -42.5 },
        amount: 99,
      })
    ).toBe(42.5);
  });

  it("falls back to split row amount when no bank tx", () => {
    expect(
      paidAmountFromSplitRow({
        transactions: null,
        amount: "120.00",
      })
    ).toBe(120);
  });
});

describe("merchantLabelFromSplitRow", () => {
  it("uses description when no bank merchant", () => {
    expect(
      merchantLabelFromSplitRow({
        transactions: null,
        description: "Dinner",
      })
    ).toBe("Dinner");
  });

  it("defaults to Expense", () => {
    expect(merchantLabelFromSplitRow({})).toBe("Expense");
  });
});
