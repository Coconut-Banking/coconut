import { describe, it, expect } from "vitest";
import {
  distributeExtras,
  computePersonShares,
  type ReceiptItem,
  type Assignee,
} from "../receipt-split";
import {
  computeEqualShares,
  computePercentShares,
  computeSharesByRatio,
  computeTwoWayShares,
  allocateCrossGroupSettlementPayments,
  sumShareAmountsCents,
  toCents,
  validateCustomShares,
} from "../expense-shares";
import {
  computeBalances,
  computePairwiseBalance,
  getSuggestedSettlements,
} from "../split-balances";

function item(id: string, name: string, total: number): ReceiptItem {
  return { id, name, quantity: 1, unitPrice: total, totalPrice: total };
}

describe("receipt split invariants", () => {
  it("distributeExtras: sum(finalPrice) === subtotal + tax + tip + fees", () => {
    const items = [item("1", "A", 12.99), item("2", "B", 8.5), item("3", "C", 3.75)];
    const subtotal = 25.24;
    const tax = 2.27;
    const tip = 5;
    const result = distributeExtras(items, subtotal, tax, tip, 1.5);
    const sumFinal = result.reduce((s, r) => s + r.finalPrice, 0);
    expect(toCents(sumFinal)).toBe(toCents(subtotal + tax + tip + 1.5));
  });

  it("computePersonShares: per-item assignee totals sum to item finalPrice", () => {
    const items = distributeExtras(
      [item("1", "Pizza", 20), item("2", "Salad", 10)],
      30,
      3,
      2,
    );
    const assignments = new Map<string, Assignee[]>([
      ["1", [{ name: "Alice", memberId: "a" }, { name: "Bob", memberId: "b" }]],
      ["2", [{ name: "Alice", memberId: "a" }, { name: "Bob", memberId: "b" }, { name: "Carol", memberId: "c" }]],
    ]);
    const shares = computePersonShares(items, assignments);
    for (const row of items) {
      const assignees = assignments.get(row.id) ?? [];
      const names = new Set(assignees.map((a) => a.name.toLowerCase()));
      let itemSum = 0;
      for (const p of shares) {
        if (!names.has(p.name.toLowerCase())) continue;
        const line = p.items.find((i) => i.itemName === row.name);
        if (line) itemSum += line.shareAmount;
      }
      expect(toCents(itemSum)).toBe(toCents(row.finalPrice));
    }
  });
});

describe("expense share invariants", () => {
  const amounts = [0.01, 0.99, 1, 10, 10.01, 33.33, 100, 999.99];

  it("computeEqualShares always sums to total (stress)", () => {
    for (const amt of amounts) {
      for (const n of [1, 2, 3, 4, 7, 11]) {
        const ids = Array.from({ length: n }, (_, i) => `m${i}`);
        const shares = computeEqualShares(amt, ids);
        expect(sumShareAmountsCents(shares)).toBe(toCents(amt));
      }
    }
  });

  it("computePercentShares sums to total when percents are 100", () => {
    const shares = computePercentShares(100, [
      { memberId: "a", percent: 33.3 },
      { memberId: "b", percent: 33.3 },
      { memberId: "c", percent: 33.4 },
    ]);
    expect(sumShareAmountsCents(shares)).toBe(10000);
  });

  it("computeSharesByRatio sums to total", () => {
    const shares = computeSharesByRatio(50, [
      { memberId: "a", weight: 2 },
      { memberId: "b", weight: 1 },
      { memberId: "c", weight: 1 },
    ]);
    expect(sumShareAmountsCents(shares)).toBe(5000);
  });

  it("computeTwoWayShares sums to total", () => {
    for (const amt of amounts) {
      const shares = computeTwoWayShares(amt, "z", "a");
      expect(sumShareAmountsCents(shares)).toBe(toCents(amt));
    }
  });

  it("validateCustomShares uses cent tolerance", () => {
    expect(
      validateCustomShares(10.01, [
        { memberId: "a", amount: 5.01 },
        { memberId: "b", amount: 5 },
      ]).valid,
    ).toBe(true);
  });
});

describe("cross-group settlement allocation", () => {
  it("single bucket caps at amount owed", () => {
    const out = allocateCrossGroupSettlementPayments(50, [
      {
        groupId: "g1",
        payerMemberId: "p",
        receiverMemberId: "r",
        amountOwed: 12,
        currency: "USD",
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].payAmount).toBe(12);
  });

  it("multi-bucket partial payment sums to payment and respects caps", () => {
    const buckets = [
      { groupId: "g1", payerMemberId: "p", receiverMemberId: "r", amountOwed: 20, currency: "USD" },
      { groupId: "g2", payerMemberId: "p", receiverMemberId: "r", amountOwed: 30, currency: "USD" },
    ];
    const out = allocateCrossGroupSettlementPayments(25, buckets);
    const paid = out.reduce((s, x) => s + x.payAmount, 0);
    expect(toCents(paid)).toBe(2500);
    for (const row of out) {
      const cap = buckets.find((b) => b.groupId === row.groupId)!.amountOwed;
      expect(row.payAmount).toBeLessThanOrEqual(cap + 0.001);
    }
  });

  it("full pay across two groups covers both caps", () => {
    const buckets = [
      { groupId: "g1", payerMemberId: "p", receiverMemberId: "r", amountOwed: 20, currency: "USD" },
      { groupId: "g2", payerMemberId: "p", receiverMemberId: "r", amountOwed: 30, currency: "USD" },
    ];
    const out = allocateCrossGroupSettlementPayments(50, buckets);
    expect(sumShareAmountsCents(out.map((x) => ({ amount: x.payAmount })))).toBe(5000);
    expect(out.find((x) => x.groupId === "g1")?.payAmount).toBe(20);
    expect(out.find((x) => x.groupId === "g2")?.payAmount).toBe(30);
  });
});

describe("group balance ledger invariants", () => {
  it("computeBalances: group net totals sum to zero after balanced expense", () => {
    const balances = computeBalances(
      [{ member_id: "a", amount: 60 }],
      [
        { member_id: "a", amount: 20 },
        { member_id: "b", amount: 20 },
        { member_id: "c", amount: 20 },
      ],
      [],
      [],
    );
    const sum = Array.from(balances.values()).reduce((s, m) => s + m.total, 0);
    expect(Math.round(sum * 100)).toBe(0);
  });

  it("settlement reduces payer debt in pairwise balance", () => {
    const splits = [{ id: "s1", payerMemberId: "a" as string | null }];
    const shares = new Map([["s1", [{ member_id: "b", amount: 40 }]]]);
    const currencyMap = new Map([["s1", "USD"]]);

    const before = computePairwiseBalance("a", "b", splits, shares, [], currencyMap, "USD");
    expect(before).toBe(40);

    const after = computePairwiseBalance(
      "a",
      "b",
      splits,
      shares,
      [{ payer_member_id: "b", receiver_member_id: "a", amount: 15, currency: "USD" }],
      currencyMap,
      "USD",
    );
    expect(after).toBe(25);
  });

  it("getSuggestedSettlements amounts match creditor/debtor totals", () => {
    const balances = computeBalances(
      [
        { member_id: "a", amount: 100 },
        { member_id: "b", amount: 0 },
      ],
      [
        { member_id: "a", amount: 0 },
        { member_id: "b", amount: 100 },
      ],
      [],
      [],
    );
    const suggestions = getSuggestedSettlements(balances);
    const totalFlow = suggestions.reduce((s, x) => s + x.amount, 0);
    expect(Math.round(totalFlow * 100)).toBe(10000);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].fromMemberId).toBe("b");
    expect(suggestions[0].toMemberId).toBe("a");
  });
});
