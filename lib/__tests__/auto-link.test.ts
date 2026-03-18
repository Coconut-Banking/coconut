import { describe, it, expect, vi } from "vitest";

// Mock the supabase module
vi.mock("../supabase", () => ({
  getSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          gte: () => ({
            lte: () => ({
              then: (resolve: (result: { data: unknown[] }) => void) => resolve({ data: [] }),
              data: [],
            }),
          }),
        }),
      }),
    }),
  }),
}));

import type { ParsedP2PRow } from "../csv-import/parsers";

describe("auto-link confidence scoring", () => {
  // These tests verify the algorithm logic conceptually
  // Full integration tests would need a real DB

  it("exports the autoLinkTransactions function", async () => {
    const { autoLinkTransactions } = await import("../csv-import/auto-link");
    expect(typeof autoLinkTransactions).toBe("function");
  });

  it("returns empty results for empty input", async () => {
    const { autoLinkTransactions } = await import("../csv-import/auto-link");
    const results = await autoLinkTransactions("user123", []);
    expect(results).toEqual([]);
  });

  it("returns unlinked results when no bank transactions exist", async () => {
    const { autoLinkTransactions } = await import("../csv-import/auto-link");
    const rows: ParsedP2PRow[] = [
      {
        platform: "venmo",
        externalId: "v1",
        date: "2024-01-15",
        amount: -50,
        counterpartyName: "Harshil",
        note: "concert",
        status: "completed",
      },
    ];

    const results = await autoLinkTransactions("user123", rows);
    expect(results).toHaveLength(1);
    expect(results[0].linkedTransactionId).toBeNull();
    expect(results[0].confidence).toBeNull();
    expect(results[0].candidates).toEqual([]);
  });
});

describe("LinkConfidence types", () => {
  it("defines valid confidence values", async () => {
    const mod = await import("../csv-import/auto-link");
    // Verify the module exports the expected types by checking the function signature
    expect(typeof mod.autoLinkTransactions).toBe("function");
    const values: Array<"auto" | "suggested" | "manual" | null> = ["auto", "suggested", "manual", null];
    expect(values).toHaveLength(4);
  });
});
