/**
 * Regression test for BUG-CRITICAL-1: Sign Convention Break in analyze-coconut
 *
 * Coconut DB stores expense amounts as NEGATIVE (e.g., -50.00 for a $50 charge).
 * categorizeTransactions() expects POSITIVE Plaid-format amounts and skips any
 * transaction where amount <= 0.
 *
 * The bug: route.ts was changed from `amount: -(tx.amount as number)` to
 * `amount: tx.amount as number`, so all Coconut DB transactions (negative) were
 * filtered out, producing a zero spend profile and wrong card recommendations.
 *
 * The fix: restore the negation so DB amounts are flipped to positive before
 * being passed to categorizeTransactions().
 */

import { describe, it, expect } from "vitest";
import { categorizeTransactions } from "../card-recommendations";

describe("analyze-coconut sign convention (BUG-CRITICAL-1)", () => {
  /**
   * Simulate the mapping that analyze-coconut/route.ts does before calling
   * categorizeTransactions(). The DB row has amount = -50 (Coconut convention).
   *
   * BUGGY path:  amount: tx.amount           → passes -50 → skipped (≤ 0)
   * FIXED path:  amount: -(tx.amount)        → passes +50 → counted
   */

  it("produces non-zero spend when Coconut DB rows (negative amounts) are negated before categorizing", () => {
    // Simulate a DB row with Coconut sign convention (negative = expense)
    const dbAmount = -50; // $50 dining charge stored as -50 in Coconut DB

    // Fixed mapping: negate the DB amount before passing to categorizeTransactions
    const rows = [
      {
        amount: -dbAmount, // -(−50) = +50  ← the fix
        primary_category: "FOOD_AND_DRINK",
        detailed_category: "RESTAURANTS",
        merchant_name: "Test Restaurant",
        raw_name: "Test Restaurant",
      },
    ];

    const result = categorizeTransactions(rows, 1);
    expect(result.dining).toBe(50);
    expect(result.total).toBeGreaterThan(0);
  });

  it("produces zero spend when Coconut DB rows are passed WITHOUT negation (demonstrates the bug)", () => {
    // Simulate the BUGGY mapping: amount passed as-is (still negative)
    const dbAmount = -50;

    const rows = [
      {
        amount: dbAmount, // -50  ← the bug: categorizeTransactions skips amount <= 0
        primary_category: "FOOD_AND_DRINK",
        detailed_category: "RESTAURANTS",
        merchant_name: "Test Restaurant",
        raw_name: "Test Restaurant",
      },
    ];

    const result = categorizeTransactions(rows, 1);
    // All transactions are filtered out because amount <= 0
    expect(result.dining).toBe(0);
    expect(result.total).toBe(0);
  });

  it("correctly categorizes multiple Coconut DB transactions across spend categories when negated", () => {
    // Multiple DB rows in Coconut sign convention (all negative)
    const dbRows = [
      { amount: -120, primary_category: "FOOD_AND_DRINK", detailed_category: "RESTAURANTS", merchant_name: null, raw_name: null },
      { amount: -300, primary_category: "TRAVEL", detailed_category: "AIRLINES", merchant_name: null, raw_name: null },
      { amount: -200, primary_category: "GROCERIES", detailed_category: "SUPERMARKET", merchant_name: null, raw_name: null },
    ];

    // Fixed mapping: negate each amount
    const rows = dbRows.map((tx) => ({ ...tx, amount: -(tx.amount) }));

    const result = categorizeTransactions(rows, 1);
    expect(result.dining).toBe(120);
    expect(result.travel).toBe(300);
    expect(result.groceries).toBe(200);
    expect(result.total).toBe(620);
  });
});
