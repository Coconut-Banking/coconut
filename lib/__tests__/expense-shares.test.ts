import { describe, it, expect } from "vitest";
import {
  computeEqualShares,
  computeTwoWayShares,
  validateCustomShares,
  toCents,
} from "../expense-shares";

describe("toCents", () => {
  it("converts dollar amounts to integer cents", () => {
    expect(toCents(1)).toBe(100);
    expect(toCents(10.5)).toBe(1050);
    expect(toCents(0.01)).toBe(1);
    expect(toCents(99.99)).toBe(9999);
  });

  it("handles IEEE 754 edge case (0.1 + 0.2)", () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
  });
});

describe("computeEqualShares", () => {
  it("splits amount equally among members", () => {
    const shares = computeEqualShares(100, ["A", "B", "C", "D"]);
    expect(shares).toHaveLength(4);
    const total = shares.reduce((s, sh) => s + sh.amount, 0);
    expect(total).toBe(100);
    expect(shares[0].amount).toBe(25);
    expect(shares[1].amount).toBe(25);
    expect(shares[2].amount).toBe(25);
    expect(shares[3].amount).toBe(25);
  });

  it("handles remainder by adding to first member", () => {
    const shares = computeEqualShares(10, ["A", "B", "C"]);
    expect(shares.reduce((s, sh) => s + sh.amount, 0)).toBe(10);
    expect(shares[0].amount).toBe(3.34);
    expect(shares[1].amount).toBe(3.33);
    expect(shares[2].amount).toBe(3.33);
  });

  it("distributes remainder across multiple members ($100 / 7)", () => {
    const shares = computeEqualShares(100, ["A", "B", "C", "D", "E", "F", "G"]);
    const total = shares.reduce((s, sh) => s + sh.amount, 0);
    expect(Math.round(total * 100)).toBe(10000);
    // 10000 / 7 = 1428 base, remainder 4
    expect(shares[0].amount).toBe(14.29); // 1429/100
    expect(shares[3].amount).toBe(14.29); // 1429/100 (4th gets extra)
    expect(shares[4].amount).toBe(14.28); // 1428/100 (5th does not)
    expect(shares[6].amount).toBe(14.28); // 1428/100
  });

  it("returns empty for no members", () => {
    expect(computeEqualShares(50, [])).toEqual([]);
  });

  it("rounds to 2 decimal places", () => {
    const shares = computeEqualShares(33.33, ["A", "B", "C"]);
    const total = shares.reduce((s, sh) => s + sh.amount, 0);
    expect(Math.round(total * 100) / 100).toBe(33.33);
  });

  it("handles $0.01 among 3 (extreme)", () => {
    const shares = computeEqualShares(0.01, ["A", "B", "C"]);
    const total = shares.reduce((s, sh) => s + sh.amount, 0);
    expect(Math.round(total * 100)).toBe(1);
    expect(shares[0].amount).toBe(0.01);
    expect(shares[1].amount).toBe(0);
    expect(shares[2].amount).toBe(0);
  });

  it("stress: total always matches for various amounts and group sizes", () => {
    const amounts = [0.01, 0.99, 1, 10, 10.01, 33.33, 100, 999.99];
    const sizes = [1, 2, 3, 4, 5, 7, 10, 13];
    for (const amt of amounts) {
      for (const n of sizes) {
        const ids = Array.from({ length: n }, (_, i) => `M${i}`);
        const shares = computeEqualShares(amt, ids);
        const totalCents = shares.reduce((s, sh) => s + Math.round(sh.amount * 100), 0);
        expect(totalCents).toBe(Math.round(amt * 100));
      }
    }
  });
});

describe("computeTwoWayShares", () => {
  it("splits 50/50 for two members", () => {
    const shares = computeTwoWayShares(100, "A", "B");
    expect(shares).toEqual([
      { memberId: "A", amount: 50 },
      { memberId: "B", amount: 50 },
    ]);
  });

  it("handles odd amounts", () => {
    const shares = computeTwoWayShares(10, "A", "B");
    expect(shares.reduce((s, sh) => s + sh.amount, 0)).toBe(10);
    expect(shares[0].amount).toBe(5);
    expect(shares[1].amount).toBe(5);
  });

  it("handles uneven split (e.g. 33.33)", () => {
    const shares = computeTwoWayShares(33.33, "A", "B");
    expect(Math.round((shares[0].amount + shares[1].amount) * 100) / 100).toBe(33.33);
  });

  it("handles odd-cent total (10.01)", () => {
    const shares = computeTwoWayShares(10.01, "A", "B");
    expect(shares[0].amount).toBe(5);
    expect(shares[1].amount).toBe(5.01);
  });
});

describe("validateCustomShares", () => {
  it("accepts valid shares that sum to amount", () => {
    const result = validateCustomShares(100, [
      { memberId: "A", amount: 60 },
      { memberId: "B", amount: 40 },
    ]);
    expect(result.valid).toBe(true);
  });

  it("rejects shares that do not sum to amount", () => {
    const result = validateCustomShares(100, [
      { memberId: "A", amount: 50 },
      { memberId: "B", amount: 40 },
    ]);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("100.00");
  });

  it("accepts shares within 1-cent tolerance", () => {
    const result = validateCustomShares(100, [
      { memberId: "A", amount: 50 },
      { memberId: "B", amount: 50.005 },
    ]);
    expect(result.valid).toBe(true);
  });

  it("accepts when at least one share is positive", () => {
    const result = validateCustomShares(100, [
      { memberId: "A", amount: 50 },
      { memberId: "B", amount: 50 },
    ]);
    expect(result.valid).toBe(true);
  });

  it("rejects when all shares are zero but sum matches", () => {
    const result = validateCustomShares(0, [
      { memberId: "A", amount: 0 },
      { memberId: "B", amount: 0 },
    ]);
    expect(result.valid).toBe(false);
  });

  it("handles floating-point sum correctly (0.1 + 0.2 = 0.3)", () => {
    const result = validateCustomShares(0.3, [
      { memberId: "A", amount: 0.1 },
      { memberId: "B", amount: 0.2 },
    ]);
    expect(result.valid).toBe(true);
  });
});
