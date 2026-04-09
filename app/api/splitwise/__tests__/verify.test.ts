import { describe, it, expect } from "vitest";

/**
 * Unit tests for mirrorExpenseCount logic in GET /api/splitwise/verify
 *
 * Regression test for BUG-CRITICAL-1:
 *   The original ternary was inverted — when `expenses` was truthy (array
 *   present), the count was set to 0.  The corrected code uses optional
 *   chaining so the count equals the actual array length.
 *
 * Because the full route requires Supabase + Splitwise HTTP mocks, we test
 * the count derivation in isolation by extracting the same expression used
 * in the route.
 */

/**
 * Mirrors the FIXED expression from the route (line ~253):
 *
 *   const mirrorExpenseCount =
 *     ((swMirror as { expenses?: unknown[] }).expenses as unknown[] | undefined)?.length ?? 0;
 *
 * The OLD (buggy) expression was:
 *
 *   const mirrorExpenseCount = (swMirror as { expenses?: unknown[] }).expenses
 *     ? 0
 *     : swMirror.simplified_debts?.length ?? 0;
 */
function mirrorExpenseCountFixed(swMirror: {
  expenses?: unknown[];
  simplified_debts?: unknown[];
}): number {
  return (
    (swMirror as { expenses?: unknown[] }).expenses as unknown[] | undefined
  )?.length ?? 0;
}

/** Reproduces the OLD buggy logic so tests can confirm they would have failed. */
function mirrorExpenseCountBuggy(swMirror: {
  expenses?: unknown[];
  simplified_debts?: unknown[];
}): number {
  return (swMirror as { expenses?: unknown[] }).expenses
    ? 0
    : swMirror.simplified_debts?.length ?? 0;
}

describe("mirrorExpenseCount — BUG-CRITICAL-1", () => {
  describe("FIXED expression", () => {
    it("returns the array length when expenses is a non-empty array", () => {
      const swMirror = {
        expenses: [{ id: 1 }, { id: 2 }, { id: 3 }],
        simplified_debts: [{ from: 1, to: 2 }],
      };
      expect(mirrorExpenseCountFixed(swMirror)).toBe(3);
    });

    it("returns 0 when expenses is an empty array", () => {
      const swMirror = {
        expenses: [] as unknown[],
        simplified_debts: [{ from: 1, to: 2 }],
      };
      expect(mirrorExpenseCountFixed(swMirror)).toBe(0);
    });

    it("returns 0 when expenses is undefined", () => {
      const swMirror = {
        simplified_debts: [{ from: 1, to: 2 }, { from: 3, to: 4 }],
      };
      expect(mirrorExpenseCountFixed(swMirror)).toBe(0);
    });

    it("returns 0 when both expenses and simplified_debts are absent", () => {
      const swMirror = {};
      expect(mirrorExpenseCountFixed(swMirror)).toBe(0);
    });

    it("returns correct count with a single-element expenses array", () => {
      const swMirror = {
        expenses: [{ id: 42 }],
      };
      expect(mirrorExpenseCountFixed(swMirror)).toBe(1);
    });
  });

  describe("OLD (buggy) expression — should produce wrong results", () => {
    it("incorrectly returns 0 when expenses array is present (demonstrates the bug)", () => {
      const swMirror = {
        expenses: [{ id: 1 }, { id: 2 }, { id: 3 }],
        simplified_debts: [{ from: 1, to: 2 }],
      };
      // The bug: truthy expenses branch returns 0 instead of 3
      expect(mirrorExpenseCountBuggy(swMirror)).toBe(0);
      // Confirm the fixed version returns the correct value
      expect(mirrorExpenseCountFixed(swMirror)).toBe(3);
    });

    it("incorrectly falls through to simplified_debts when expenses is absent", () => {
      const swMirror = {
        simplified_debts: [{ from: 1, to: 2 }, { from: 3, to: 4 }],
      };
      // Buggy code uses simplified_debts.length as a proxy — semantically wrong
      expect(mirrorExpenseCountBuggy(swMirror)).toBe(2);
      // Fixed code correctly returns 0 (expenses absent means no count)
      expect(mirrorExpenseCountFixed(swMirror)).toBe(0);
    });
  });
});
