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
    it("returns merchant_keywords + amount_lt for coffee query when OpenAI provides them", async () => {
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
                merchant_keywords: ["coffee", "cafe", "starbucks", "dunkin", "espresso"],
                category: "FOOD_AND_DRINK",
                amount_gt: null,
                amount_lt: 15,
                concept_label: "coffee/cafes",
              }),
            },
          },
        ],
      });

      const intent = await extractIntent("how much did I spend on coffee in the past month");

      expect(intent.merchant_keywords).toEqual(["coffee", "cafe", "starbucks", "dunkin", "espresso"]);
      expect(intent.category).toBe("FOOD_AND_DRINK");
      expect(intent.amount_lt).toBe(15);
      expect(intent.concept_label).toBe("coffee/cafes");
      expect(intent.metric).toBe("sum");
    });

    it("returns broad category only for generic food query (no merchant_keywords)", async () => {
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
                merchant_keywords: null,
                category: "FOOD_AND_DRINK",
                amount_gt: null,
                amount_lt: null,
                concept_label: null,
              }),
            },
          },
        ],
      });

      const intent = await extractIntent("how much did I spend on food in the past month");

      expect(intent.merchant_keywords).toBeNull();
      expect(intent.category).toBe("FOOD_AND_DRINK");
      expect(intent.amount_lt).toBeNull();
      expect(intent.concept_label).toBeNull();
    });

    it("validates and sanitizes merchant_keywords array", async () => {
      const { extractIntent } = await import("../search-engine");
      mockCompletionCreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                metric: "list",
                date_start: "2026-01-01",
                date_end: "2026-01-31",
                merchant: null,
                merchant_keywords: ["uber", "lyft", "", 123, null],
                category: "TRANSPORTATION",
                amount_gt: null,
                amount_lt: null,
                concept_label: null,
              }),
            },
          },
        ],
      });

      const intent = await extractIntent("my uber rides in January");

      expect(intent.merchant_keywords).toEqual(["uber", "lyft"]);
    });
  });

  describe("search", () => {
    it("returns transactions and answer with concept_label when merchant_keywords present", async () => {
      const { search } = await import("../search-engine");
      mockCompletionCreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                metric: "sum",
                date_start: "2026-02-10",
                date_end: "2026-03-11",
                merchant: null,
                merchant_keywords: ["coffee", "cafe"],
                category: "FOOD_AND_DRINK",
                amount_gt: null,
                amount_lt: 15,
                concept_label: "coffee/cafes",
              }),
            },
          },
        ],
      });

      const result = await search("user_123", "how much did I spend on coffee in the past month");

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0].merchant_name).toBe("Progeny Coffee");
      expect(result.total).toBe(7.5);
      expect(result.answer).toContain("coffee/cafes");
      expect(result.answer).toContain("$7.50");
      expect(mockOr).toHaveBeenCalled();
    });

    it("calls or() when merchant_keywords in intent (verified via sum metric)", async () => {
      const { search } = await import("../search-engine");
      mockCompletionCreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                metric: "sum",
                date_start: "2026-02-10",
                date_end: "2026-03-11",
                merchant: null,
                merchant_keywords: ["coffee", "cafe"],
                category: "FOOD_AND_DRINK",
                amount_gt: null,
                amount_lt: 15,
                concept_label: "coffee/cafes",
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
  });
});
