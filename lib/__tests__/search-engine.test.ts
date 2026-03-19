/**
 * Search engine tests — intent extraction, filter building, answer generation.
 * Mocks OpenAI for deterministic intent parsing.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

const mockCompletionCreate = vi.fn();
vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { create: (...args: unknown[]) => mockCompletionCreate(...args) } };
    embeddings = { create: vi.fn().mockResolvedValue({ data: [{ embedding: new Array(1536).fill(0.1) }] }) };
  },
}));

const mockTxData = [
  {
    id: "1",
    plaid_transaction_id: "tx1",
    merchant_name: "Progeny Coffee",
    raw_name: "PROGENY COFFEE",
    amount: -7.5,
    date: "2026-03-10",
    primary_category: "FOOD_AND_DRINK",
    detailed_category: null,
    iso_currency_code: "USD",
    is_pending: false,
  },
];

const mockOr = vi.fn().mockImplementation(() => mockChain);
const mockChain = {
  select: vi.fn().mockReturnThis(),
  lt: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  gte: vi.fn().mockReturnThis(),
  lte: vi.fn().mockReturnThis(),
  ilike: vi.fn().mockReturnThis(),
  or: mockOr,
  then: vi.fn((fn: (v: { data: unknown; error: unknown }) => unknown) =>
    fn({ data: mockTxData, error: null })
  ),
};

vi.mock("@/lib/supabase", () => ({
  getSupabase: vi.fn(() => ({
    from: () => mockChain,
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
  })),
}));

// Must set OPENAI_API_KEY so search-engine creates openai client
const origEnv = process.env.OPENAI_API_KEY;
beforeEach(() => {
  process.env.OPENAI_API_KEY = "sk-test";
  vi.resetModules();
  vi.clearAllMocks();
  mockChain.then.mockImplementation((fn: (v: { data: unknown; error: unknown }) => unknown) =>
    fn({ data: mockTxData, error: null })
  );
});
afterEach(() => {
  process.env.OPENAI_API_KEY = origEnv;
});

describe("search-engine", () => {
  describe("extractIntent", () => {
    it("returns merchant + amount_lt when OpenAI provides them", async () => {
      const { extractIntent } = await import("../search-engine");
      mockCompletionCreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                metric: "sum",
                date_start: "2026-02-10",
                date_end: "2026-03-11",
                merchant: "coffee",
                category: "FOOD_AND_DRINK",
                amount_gt: null,
                amount_lt: 15,
              }),
            },
          },
        ],
      });

      const intent = await extractIntent("how much did I spend on coffee in the past month");

      expect(intent.merchant).toBe("coffee");
      expect(intent.category).toBe("FOOD_AND_DRINK");
      expect(intent.amount_lt).toBe(15);
      expect(intent.metric).toBe("sum");
    });

    it("returns broad category only for generic food query (no merchant)", async () => {
      const { extractIntent } = await import("../search-engine");
      mockCompletionCreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                metric: "sum",
                date_start: "2026-02-10",
                date_end: "2026-03-11",
                merchant: null,
                category: "FOOD_AND_DRINK",
                amount_gt: null,
                amount_lt: null,
              }),
            },
          },
        ],
      });

      const intent = await extractIntent("how much did I spend on food in the past month");

      expect(intent.merchant).toBeNull();
      expect(intent.category).toBe("FOOD_AND_DRINK");
      expect(intent.amount_lt).toBeNull();
    });

    it("validates merchant string for rideshare query", async () => {
      const { extractIntent } = await import("../search-engine");
      mockCompletionCreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                metric: "list",
                date_start: "2026-01-01",
                date_end: "2026-01-31",
                merchant: "uber",
                category: "TRANSPORTATION",
                amount_gt: null,
                amount_lt: null,
              }),
            },
          },
        ],
      });

      const intent = await extractIntent("my uber rides in January");

      expect(intent.merchant).toBe("uber");
    });
  });

  describe("search", () => {
    it("returns transactions and answer when merchant filter present", async () => {
      const { search } = await import("../search-engine");
      mockCompletionCreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                metric: "sum",
                date_start: "2026-02-10",
                date_end: "2026-03-11",
                merchant: "coffee",
                category: "FOOD_AND_DRINK",
                amount_gt: null,
                amount_lt: 15,
              }),
            },
          },
        ],
      });

      const result = await search("user_123", "how much did I spend on coffee in the past month");

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0].merchant_name).toBe("Progeny Coffee");
      expect(result.total).toBe(7.5);
      expect(result.answer).toContain("$7.50");
      expect(mockOr).toHaveBeenCalled();
    });

    it("calls or() when merchant in intent (hybrid merchant matching)", async () => {
      const { search } = await import("../search-engine");
      mockCompletionCreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                metric: "sum",
                date_start: "2026-02-10",
                date_end: "2026-03-11",
                merchant: "coffee",
                category: "FOOD_AND_DRINK",
                amount_gt: null,
                amount_lt: null,
              }),
            },
          },
        ],
      });

      await search("user_123", "coffee last month");

      expect(mockOr).toHaveBeenCalledWith(
        expect.stringMatching(/normalized_merchant\.ilike.*coffee/)
      );
    });

    it("plural merchant 'ubers' matches multiple Uber transactions (merchantPatterns)", async () => {
      const fiveUberTxs = [
        { id: "1", plaid_transaction_id: "tx1", merchant_name: "Uber", raw_name: "UBER TRIP", amount: -16.1, date: "2026-03-01", primary_category: "TRANSPORTATION", detailed_category: null, iso_currency_code: "USD", is_pending: false },
        { id: "2", plaid_transaction_id: "tx2", merchant_name: "Uber", raw_name: "UBER", amount: -12.5, date: "2026-03-05", primary_category: "TRANSPORTATION", detailed_category: null, iso_currency_code: "USD", is_pending: false },
        { id: "3", plaid_transaction_id: "tx3", merchant_name: "Uber", raw_name: "Uber", amount: -8, date: "2026-03-10", primary_category: "TRANSPORTATION", detailed_category: null, iso_currency_code: "USD", is_pending: false },
        { id: "4", plaid_transaction_id: "tx4", merchant_name: "Uber", raw_name: "UBER TRIP", amount: -22, date: "2026-03-12", primary_category: "TRANSPORTATION", detailed_category: null, iso_currency_code: "USD", is_pending: false },
        { id: "5", plaid_transaction_id: "tx5", merchant_name: "Uber", raw_name: "Uber", amount: -5.5, date: "2026-03-15", primary_category: "TRANSPORTATION", detailed_category: null, iso_currency_code: "USD", is_pending: false },
      ];
      mockChain.then.mockImplementation((fn: (v: { data: unknown; error: unknown }) => unknown) =>
        fn({ data: fiveUberTxs, error: null })
      );
      mockCompletionCreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                metric: "sum",
                date_start: "2026-02-18",
                date_end: "2026-03-18",
                merchant: "ubers",
                merchant_keywords: null,
                category: null,
                amount_gt: null,
                amount_lt: null,
              }),
            },
          },
        ],
      });

      const { search } = await import("../search-engine");
      const result = await search("user_123", "How much did I spend on Ubers in the past month?");

      expect(result.transactions).toHaveLength(5);
      expect(result.total).toBe(16.1 + 12.5 + 8 + 22 + 5.5);
      expect(result.answer).toMatch(/5 transaction/);
      expect(mockOr).toHaveBeenCalledWith(
        expect.stringMatching(/normalized_merchant\.ilike\.%uber%/)
      );
    });
  });
});
