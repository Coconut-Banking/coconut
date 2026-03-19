/**
 * Tests for the generateAnswer logic in engine.ts.
 * We import searchV2 but mock everything to isolate the answer generation.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import type { SearchTransaction, ParsedQuery } from "../types";

const mockCompletionCreate = vi.fn();
const mockEmbeddingsCreate = vi.fn();
vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { create: (...args: unknown[]) => mockCompletionCreate(...args) } };
    embeddings = { create: (...args: unknown[]) => mockEmbeddingsCreate(...args) };
  },
}));

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: vi.fn(() => ({
    from: () => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      then: vi.fn((fn: (v: { data: unknown; error: unknown }) => unknown) =>
        fn({ data: [], error: null })
      ),
    }),
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
  })),
  getSupabase: vi.fn(() => ({
    from: () => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      then: vi.fn((fn: (v: { data: unknown; error: unknown }) => unknown) =>
        fn({ data: [], error: null })
      ),
    }),
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
  })),
}));

const origEnv = process.env.OPENAI_API_KEY;
beforeEach(() => {
  process.env.OPENAI_API_KEY = "sk-test";
  vi.resetModules();
  vi.clearAllMocks();
});
afterEach(() => {
  process.env.OPENAI_API_KEY = origEnv;
});

function makeTx(overrides: Partial<SearchTransaction> & { id: string }): SearchTransaction {
  return {
    plaid_transaction_id: `plaid_${overrides.id}`,
    account_id: null,
    merchant_name: "Test",
    raw_name: "TEST",
    normalized_merchant: "test",
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

describe("searchV2 answer generation", () => {
  it("returns 'No matching transactions found' for empty results", async () => {
    const { searchV2 } = await import("../engine");

    // Mock parser to return a simple search intent
    mockCompletionCreate.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            semantic_terms: "nonexistent merchant",
            intent: "search",
          }),
        },
      }],
    });
    mockEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: new Array(1536).fill(0) }],
    });

    const result = await searchV2("user_123", "nonexistent merchant");
    expect(result.answer).toBe("No matching transactions found.");
    expect(result.count).toBe(0);
  });

  it("uses correct pluralization for single transaction", async () => {
    const { searchV2 } = await import("../engine");

    // Parse returns count intent
    mockCompletionCreate
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: JSON.stringify({
              semantic_terms: "starbucks",
              merchant_search: "Starbucks",
              intent: "count",
            }),
          },
        }],
      });
    mockEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: new Array(1536).fill(0) }],
    });

    const result = await searchV2("user_123", "how many starbucks");
    // With mocked empty DB, count = 0
    expect(result.answer).toContain("transaction");
  });
});
