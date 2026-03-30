import { describe, it, expect } from "vitest";
import { computeBalances, getSuggestedSettlements } from "./split-balances";

describe("computeBalances", () => {
  it("computes net balance from paid and owed", () => {
    const paid = [{ member_id: "A", amount: 100 }];
    const owed = [
      { member_id: "A", amount: 50 },
      { member_id: "B", amount: 50 },
    ];
    const balances = computeBalances(paid, owed, [], []);
    expect(balances.get("A")?.total).toBe(50); // paid 100, owed 50 → creditor
    expect(balances.get("B")?.total).toBe(-50); // owed 50 → debtor
  });

  it("after settlement: debtor pays creditor, both go to zero", () => {
    const paid = [{ member_id: "A", amount: 100 }];
    const owed = [
      { member_id: "A", amount: 50 },
      { member_id: "B", amount: 50 },
    ];
    const paidSettlements = [{ payer_member_id: "B", amount: 50 }];
    const receivedSettlements = [{ receiver_member_id: "A", amount: 50 }];
    const balances = computeBalances(paid, owed, paidSettlements, receivedSettlements);
    expect(Math.round((balances.get("A")?.total ?? 0) * 100) / 100).toBe(0);
    expect(Math.round((balances.get("B")?.total ?? 0) * 100) / 100).toBe(0);
  });

  it("rounds to 2 decimal places", () => {
    const paid = [{ member_id: "A", amount: 33.33 }];
    const owed = [
      { member_id: "A", amount: 11.11 },
      { member_id: "B", amount: 11.11 },
      { member_id: "C", amount: 11.11 },
    ];
    const balances = computeBalances(paid, owed, [], []);
    expect(balances.get("A")?.total).toBe(22.22);
  });
});

describe("getSuggestedSettlements", () => {
  it("suggests debtor pays creditor", () => {
    const balances = new Map([
      ["A", { memberId: "A", paid: 100, owed: 50, total: 50 }],
      ["B", { memberId: "B", paid: 0, owed: 50, total: -50 }],
    ]);
    const suggestions = getSuggestedSettlements(balances);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toEqual({
      fromMemberId: "B",
      toMemberId: "A",
      amount: 50,
    });
  });

  it("returns empty when all settled", () => {
    const balances = new Map([
      ["A", { memberId: "A", paid: 50, owed: 50, total: 0 }],
      ["B", { memberId: "B", paid: 50, owed: 50, total: 0 }],
    ]);
    const suggestions = getSuggestedSettlements(balances);
    expect(suggestions).toHaveLength(0);
  });

  it("does not double-count multiple settlements", () => {
    const paid = [{ member_id: "A", amount: 100 }];
    const owed = [
      { member_id: "A", amount: 50 },
      { member_id: "B", amount: 50 },
    ];
    const paidSettlements = Array(3).fill({ payer_member_id: "B", amount: 50 });
    const receivedSettlements = Array(3).fill({ receiver_member_id: "A", amount: 50 });
    const balances = computeBalances(paid, owed, paidSettlements, receivedSettlements);
    expect(Math.round((balances.get("A")?.total ?? 0) * 100) / 100).toBe(-100);
    expect(Math.round((balances.get("B")?.total ?? 0) * 100) / 100).toBe(100);
  });

  it("handles 3-way: largest debtor to largest creditor", () => {
    const balances = new Map([
      ["A", { memberId: "A", paid: 100, owed: 33.33, total: 66.67 }],
      ["B", { memberId: "B", paid: 0, owed: 33.33, total: -33.33 }],
      ["C", { memberId: "C", paid: 0, owed: 33.34, total: -33.34 }],
    ]);
    const suggestions = getSuggestedSettlements(balances);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].fromMemberId).toBe("C");
    expect(suggestions[0].toMemberId).toBe("A");
  });

  it("never suggests zero or negative amounts", () => {
    const balances = new Map([
      ["A", { memberId: "A", paid: 50, owed: 0, total: 50 }],
      ["B", { memberId: "B", paid: 0, owed: 50, total: -50 }],
    ]);
    const suggestions = getSuggestedSettlements(balances);
    expect(suggestions.every((s) => s.amount > 0)).toBe(true);
  });
});

describe("settlement CRUD lifecycle", () => {
  it("partial settlement reduces balance proportionally", () => {
    const paid = [{ member_id: "A", amount: 100 }];
    const owed = [
      { member_id: "A", amount: 50 },
      { member_id: "B", amount: 50 },
    ];
    const paidSettlements = [{ payer_member_id: "B", amount: 25 }];
    const receivedSettlements = [{ receiver_member_id: "A", amount: 25 }];
    const balances = computeBalances(paid, owed, paidSettlements, receivedSettlements);
    expect(Math.round((balances.get("A")?.total ?? 0) * 100) / 100).toBe(25);
    expect(Math.round((balances.get("B")?.total ?? 0) * 100) / 100).toBe(-25);
  });

  it("full settlement zeroes both parties", () => {
    const paid = [{ member_id: "A", amount: 89.50 }];
    const owed = [
      { member_id: "A", amount: 44.75 },
      { member_id: "B", amount: 44.75 },
    ];
    const paidSettlements = [{ payer_member_id: "B", amount: 44.75 }];
    const receivedSettlements = [{ receiver_member_id: "A", amount: 44.75 }];
    const balances = computeBalances(paid, owed, paidSettlements, receivedSettlements);
    expect(Math.round((balances.get("A")?.total ?? 0) * 100) / 100).toBe(0);
    expect(Math.round((balances.get("B")?.total ?? 0) * 100) / 100).toBe(0);
    const suggestions = getSuggestedSettlements(balances);
    expect(suggestions).toHaveLength(0);
  });

  it("over-settlement flips balance direction", () => {
    const paid = [{ member_id: "A", amount: 50 }];
    const owed = [
      { member_id: "A", amount: 25 },
      { member_id: "B", amount: 25 },
    ];
    const paidSettlements = [{ payer_member_id: "B", amount: 30 }];
    const receivedSettlements = [{ receiver_member_id: "A", amount: 30 }];
    const balances = computeBalances(paid, owed, paidSettlements, receivedSettlements);
    expect(Math.round((balances.get("A")?.total ?? 0) * 100) / 100).toBe(-5);
    expect(Math.round((balances.get("B")?.total ?? 0) * 100) / 100).toBe(5);
  });

  it("multiple expenses between two people accumulate correctly", () => {
    const paid = [
      { member_id: "A", amount: 30 },
      { member_id: "A", amount: 20 },
    ];
    const owed = [
      { member_id: "A", amount: 15 },
      { member_id: "B", amount: 15 },
      { member_id: "A", amount: 10 },
      { member_id: "B", amount: 10 },
    ];
    const balances = computeBalances(paid, owed, [], []);
    expect(Math.round((balances.get("A")?.total ?? 0) * 100) / 100).toBe(25);
    expect(Math.round((balances.get("B")?.total ?? 0) * 100) / 100).toBe(-25);
  });

  it("3-person group: settling one pair doesn't affect third", () => {
    const paid = [{ member_id: "A", amount: 90 }];
    const owed = [
      { member_id: "A", amount: 30 },
      { member_id: "B", amount: 30 },
      { member_id: "C", amount: 30 },
    ];
    const paidSettlements = [{ payer_member_id: "B", amount: 30 }];
    const receivedSettlements = [{ receiver_member_id: "A", amount: 30 }];
    const balances = computeBalances(paid, owed, paidSettlements, receivedSettlements);
    expect(Math.round((balances.get("A")?.total ?? 0) * 100) / 100).toBe(30);
    expect(Math.round((balances.get("B")?.total ?? 0) * 100) / 100).toBe(0);
    expect(Math.round((balances.get("C")?.total ?? 0) * 100) / 100).toBe(-30);
  });
});
