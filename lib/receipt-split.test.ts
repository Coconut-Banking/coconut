import { describe, it, expect } from "vitest";
import {
  distributeExtras,
  computePersonShares,
  type ReceiptItem,
  type ReceiptItemWithExtras,
  type Assignee,
} from "./receipt-split";

function item(id: string, name: string, total: number): ReceiptItem {
  return { id, name, quantity: 1, unitPrice: total, totalPrice: total };
}

describe("distributeExtras", () => {
  it("distributes tax and tip proportionally", () => {
    const items = [item("1", "Bread", 5), item("2", "Steak", 45)];
    const result = distributeExtras(items, 50, 4, 10);

    // Bread: 5/50 * 14 = 1.40, final = 6.40
    expect(result[0].proportionalExtra).toBe(1.4);
    expect(result[0].finalPrice).toBe(6.4);

    // Steak: absorbs remainder = 14 - 1.40 = 12.60, final = 57.60
    expect(result[1].proportionalExtra).toBe(12.6);
    expect(result[1].finalPrice).toBe(57.6);
  });

  it("sum of finalPrices equals subtotal + tax + tip", () => {
    const items = [
      item("1", "A", 12.99),
      item("2", "B", 8.5),
      item("3", "C", 3.75),
    ];
    const subtotal = 25.24;
    const tax = 2.27;
    const tip = 5.0;
    const result = distributeExtras(items, subtotal, tax, tip);

    const sumFinal = result.reduce((s, r) => s + r.finalPrice, 0);
    expect(Math.round(sumFinal * 100) / 100).toBe(
      Math.round((subtotal + tax + tip) * 100) / 100
    );
  });

  it("handles zero tax and tip", () => {
    const items = [item("1", "X", 10)];
    const result = distributeExtras(items, 10, 0, 0);
    expect(result[0].proportionalExtra).toBe(0);
    expect(result[0].finalPrice).toBe(10);
  });

  it("handles zero subtotal", () => {
    const items = [item("1", "Free", 0)];
    const result = distributeExtras(items, 0, 2, 3);
    expect(result[0].proportionalExtra).toBe(0);
    expect(result[0].finalPrice).toBe(0);
  });

  it("handles single item", () => {
    const items = [item("1", "Dinner", 30)];
    const result = distributeExtras(items, 30, 2.7, 6);
    expect(result[0].proportionalExtra).toBe(8.7);
    expect(result[0].finalPrice).toBe(38.7);
  });
});

describe("computePersonShares", () => {
  it("splits an item equally among assignees", () => {
    const items: ReceiptItemWithExtras[] = [
      { id: "1", name: "Pizza", quantity: 1, unitPrice: 20, totalPrice: 20, proportionalExtra: 4, finalPrice: 24 },
    ];
    const assignments = new Map<string, Assignee[]>([
      ["1", [{ name: "Alice", memberId: null }, { name: "Bob", memberId: null }]],
    ]);

    const shares = computePersonShares(items, assignments);
    const alice = shares.find((s) => s.name === "Alice")!;
    const bob = shares.find((s) => s.name === "Bob")!;

    expect(alice.totalOwed).toBe(12);
    expect(bob.totalOwed).toBe(12);
    expect(alice.totalOwed + bob.totalOwed).toBe(24);
  });

  it("assigns full item to single person", () => {
    const items: ReceiptItemWithExtras[] = [
      { id: "1", name: "Salad", quantity: 1, unitPrice: 15, totalPrice: 15, proportionalExtra: 3, finalPrice: 18 },
    ];
    const assignments = new Map<string, Assignee[]>([
      ["1", [{ name: "Carol", memberId: null }]],
    ]);

    const shares = computePersonShares(items, assignments);
    expect(shares).toHaveLength(1);
    expect(shares[0].totalOwed).toBe(18);
  });

  it("aggregates multiple items per person", () => {
    const items: ReceiptItemWithExtras[] = [
      { id: "1", name: "Burger", quantity: 1, unitPrice: 12, totalPrice: 12, proportionalExtra: 2, finalPrice: 14 },
      { id: "2", name: "Fries", quantity: 1, unitPrice: 5, totalPrice: 5, proportionalExtra: 1, finalPrice: 6 },
    ];
    const assignments = new Map<string, Assignee[]>([
      ["1", [{ name: "Dave", memberId: null }]],
      ["2", [{ name: "Dave", memberId: null }]],
    ]);

    const shares = computePersonShares(items, assignments);
    expect(shares).toHaveLength(1);
    expect(shares[0].totalOwed).toBe(20);
    expect(shares[0].items).toHaveLength(2);
  });

  it("handles unassigned items (skips them)", () => {
    const items: ReceiptItemWithExtras[] = [
      { id: "1", name: "Wine", quantity: 1, unitPrice: 30, totalPrice: 30, proportionalExtra: 6, finalPrice: 36 },
    ];
    const assignments = new Map<string, Assignee[]>();

    const shares = computePersonShares(items, assignments);
    expect(shares).toHaveLength(0);
  });

  it("handles 3-way split with rounding", () => {
    const items: ReceiptItemWithExtras[] = [
      { id: "1", name: "Appetizer", quantity: 1, unitPrice: 10, totalPrice: 10, proportionalExtra: 0, finalPrice: 10 },
    ];
    const assignments = new Map<string, Assignee[]>([
      ["1", [
        { name: "A", memberId: null },
        { name: "B", memberId: null },
        { name: "C", memberId: null },
      ]],
    ]);

    const shares = computePersonShares(items, assignments);
    const total = shares.reduce((s, p) => s + p.totalOwed, 0);
    expect(Math.round(total * 100) / 100).toBe(10);
  });
});
