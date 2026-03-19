import { describe, it, expect } from "vitest";
import { reciprocalRankFusion, fuseResults } from "../fusion";
import type { SearchTransaction, ParsedQuery } from "../types";

function makeTx(overrides: Partial<SearchTransaction> & { id: string }): SearchTransaction {
  return {
    plaid_transaction_id: `plaid_${overrides.id}`,
    account_id: null,
    merchant_name: "Test Merchant",
    raw_name: "TEST MERCHANT",
    normalized_merchant: "test merchant",
    amount: -10,
    date: "2026-03-01",
    primary_category: "OTHER",
    detailed_category: null,
    iso_currency_code: "USD",
    is_pending: false,
    embed_text: null,
    ...overrides,
  };
}

const baseParsed: ParsedQuery = {
  structured_filters: {},
  semantic_terms: "test",
  intent: "search",
};

describe("reciprocalRankFusion", () => {
  it("assigns higher scores to items ranked higher across multiple lists", () => {
    const txA = makeTx({ id: "a" });
    const txB = makeTx({ id: "b" });
    const txC = makeTx({ id: "c" });

    const list1 = [txA, txB, txC];
    const list2 = [txA, txC, txB];

    const scores = reciprocalRankFusion([list1, list2]);

    expect(scores.get("a")!).toBeGreaterThan(scores.get("b")!);
    expect(scores.get("a")!).toBeGreaterThan(scores.get("c")!);
  });

  it("handles empty input", () => {
    const scores = reciprocalRankFusion([]);
    expect(scores.size).toBe(0);
  });

  it("handles a single list", () => {
    const txA = makeTx({ id: "a" });
    const txB = makeTx({ id: "b" });
    const scores = reciprocalRankFusion([[txA, txB]]);
    expect(scores.get("a")!).toBeGreaterThan(scores.get("b")!);
  });

  it("gives bonus score to items appearing in multiple lists", () => {
    const txA = makeTx({ id: "a" });
    const txB = makeTx({ id: "b" });

    // txA appears in both lists, txB only in list1
    const list1 = [txA, txB];
    const list2 = [txA];

    const scores = reciprocalRankFusion([list1, list2]);
    expect(scores.get("a")!).toBeGreaterThan(scores.get("b")!);
  });
});

describe("fuseResults", () => {
  it("deduplicates transactions from multiple sources", () => {
    const txA = makeTx({ id: "a", merchant_name: "Starbucks" });
    const txB = makeTx({ id: "b", merchant_name: "Amazon" });

    const result = fuseResults(
      [txA, txB],   // vector
      [txA],         // fulltext
      [],            // fuzzy
      [txA, txB],   // structured
      baseParsed,
    );

    const ids = result.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("intersects with structured results when date filters present", () => {
    const txA = makeTx({ id: "a" });
    const txB = makeTx({ id: "b" });
    const txC = makeTx({ id: "c" });

    const parsedWithDate: ParsedQuery = {
      structured_filters: { date_range: { start: "2026-03-01", end: "2026-03-15" } },
      semantic_terms: "test",
      intent: "search",
    };

    // txC is in vector results but NOT in structured results (outside date range)
    const result = fuseResults(
      [txA, txB, txC],  // vector finds all 3
      [],
      [],
      [txA, txB],       // structured only has A and B (within date range)
      parsedWithDate,
    );

    const ids = result.map((r) => r.id);
    expect(ids).toContain("a");
    expect(ids).toContain("b");
    expect(ids).not.toContain("c");
  });

  it("does NOT intersect when no structured filters present", () => {
    const txA = makeTx({ id: "a" });
    const txB = makeTx({ id: "b" });
    const txC = makeTx({ id: "c" });

    const result = fuseResults(
      [txA, txB, txC],
      [],
      [],
      [txA],
      baseParsed,
    );

    const ids = result.map((r) => r.id);
    expect(ids).toContain("a");
    expect(ids).toContain("b");
    expect(ids).toContain("c");
  });

  it("respects topK limit", () => {
    const txs = Array.from({ length: 10 }, (_, i) => makeTx({ id: `tx${i}` }));

    const result = fuseResults(txs, [], [], [], baseParsed, 3);
    expect(result.length).toBe(3);
  });

  it("returns empty for no input", () => {
    const result = fuseResults([], [], [], [], baseParsed);
    expect(result).toHaveLength(0);
  });

  it("preserves score property on ranked results", () => {
    const txA = makeTx({ id: "a" });
    const result = fuseResults([txA], [txA], [], [], baseParsed);
    expect(result[0].score).toBeGreaterThan(0);
  });

  it("returns empty when structured filters active but structured results empty", () => {
    const txA = makeTx({ id: "a" });
    const txB = makeTx({ id: "b" });

    const parsedWithDate: ParsedQuery = {
      structured_filters: { date_range: { start: "2026-03-01", end: "2026-03-15" } },
      semantic_terms: "test",
      intent: "search",
    };

    const result = fuseResults(
      [txA, txB],  // vector found some
      [txA],       // fulltext found some
      [],
      [],          // structured returned NOTHING (no matches for date)
      parsedWithDate,
    );

    expect(result).toHaveLength(0);
  });

  it("intersects correctly with amount_range filter", () => {
    const txA = makeTx({ id: "a", amount: -50 });
    const txB = makeTx({ id: "b", amount: -10 });

    const parsedWithAmount: ParsedQuery = {
      structured_filters: { amount_range: { min: -100, max: -40 } },
      semantic_terms: "test",
      intent: "search",
    };

    const result = fuseResults(
      [txA, txB],
      [],
      [],
      [txA],  // only txA matches the amount filter
      parsedWithAmount,
    );

    const ids = result.map((r) => r.id);
    expect(ids).toContain("a");
    expect(ids).not.toContain("b");
  });

  it("intersects correctly with is_pending filter", () => {
    const txA = makeTx({ id: "a", is_pending: true });
    const txB = makeTx({ id: "b", is_pending: false });

    const parsedPending: ParsedQuery = {
      structured_filters: { is_pending: true },
      semantic_terms: "test",
      intent: "search",
    };

    const result = fuseResults(
      [txA, txB],
      [],
      [],
      [txA],
      parsedPending,
    );

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a");
  });

  it("intersects correctly with transaction_type filter", () => {
    const txA = makeTx({ id: "a", amount: -25 });
    const txB = makeTx({ id: "b", amount: 15 });

    const parsedExpense: ParsedQuery = {
      structured_filters: { transaction_type: "expense" },
      semantic_terms: "test",
      intent: "search",
    };

    const result = fuseResults(
      [txA, txB],
      [],
      [],
      [txA],
      parsedExpense,
    );

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a");
  });

  it("handles duplicate IDs within a single ranking list", () => {
    const txA = makeTx({ id: "a" });
    // Simulate a bug where the same tx appears twice in one list
    const result = fuseResults([txA, txA], [], [], [], baseParsed);

    // Should still only have one entry in the output
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a");
    // Score should be sum of two RRF contributions (rank 0 and rank 1)
    expect(result[0].score).toBeGreaterThan(1 / (60 + 1));
  });

  it("ranks items appearing in more retrieval lists higher", () => {
    const txA = makeTx({ id: "a" });
    const txB = makeTx({ id: "b" });

    // txA appears in all 4 lists, txB only in vector
    const result = fuseResults(
      [txA, txB],  // vector
      [txA],       // fulltext
      [txA],       // fuzzy
      [txA],       // structured
      baseParsed,
    );

    expect(result[0].id).toBe("a");
    expect(result[0].score).toBeGreaterThan(result[1].score);
  });
});
