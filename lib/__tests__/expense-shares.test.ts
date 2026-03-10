import { describe, it, expect } from "vitest";
import {
  computeEqualShares,
  computeTwoWayShares,
  validateCustomShares,
} from "../expense-shares";

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
    // 10/3 = 3.33 each, remainder 0.01
    expect(shares[0].amount).toBe(3.34);
    expect(shares[1].amount).toBe(3.33);
    expect(shares[2].amount).toBe(3.33);
  });

  it("returns empty for no members", () => {
    expect(computeEqualShares(50, [])).toEqual([]);
  });

  it("rounds to 2 decimal places", () => {
    const shares = computeEqualShares(33.33, ["A", "B", "C"]);
    const total = shares.reduce((s, sh) => s + sh.amount, 0);
    expect(Math.round(total * 100) / 100).toBe(33.33);
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

  it("accepts shares within 0.01 tolerance", () => {
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
});
