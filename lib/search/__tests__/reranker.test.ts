import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import type { RankedTransaction } from "../types";

const mockCompletionCreate = vi.fn();
vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { create: (...args: unknown[]) => mockCompletionCreate(...args) } };
  },
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

function makeRankedTx(overrides: Partial<RankedTransaction> & { id: string }): RankedTransaction {
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
    score: 0.5,
    ...overrides,
  };
}

describe("rerankWithLLM", () => {
  it("filters by merchant group and returns ALL transactions from relevant merchants", async () => {
    const { rerankWithLLM } = await import("../reranker");

    const candidates = [
      makeRankedTx({ id: "1", merchant_name: "Starbucks", primary_category: "COFFEE" }),
      makeRankedTx({ id: "2", merchant_name: "Netflix", primary_category: "STREAMING" }),
      makeRankedTx({ id: "3", merchant_name: "Starbucks", primary_category: "COFFEE" }),
      makeRankedTx({ id: "4", merchant_name: "Amazon", primary_category: "SHOPPING" }),
    ];

    // LLM picks merchants 1 (Starbucks) — should return BOTH Starbucks txs
    mockCompletionCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({ relevant_merchants: [1] }),
        },
      }],
    });

    const result = await rerankWithLLM("coffee shops", candidates);

    expect(result.transactions).toHaveLength(2);
    expect(result.transactions.every((t) => t.merchant_name === "Starbucks")).toBe(true);
  });

  it("returns empty when LLM says no merchants are relevant", async () => {
    const { rerankWithLLM } = await import("../reranker");

    const candidates = [
      makeRankedTx({ id: "1", merchant_name: "Amazon" }),
      makeRankedTx({ id: "2", merchant_name: "Target" }),
      makeRankedTx({ id: "3", merchant_name: "Walmart" }),
      makeRankedTx({ id: "4", merchant_name: "Best Buy" }),
    ];

    mockCompletionCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({ relevant_merchants: [] }),
        },
      }],
    });

    const result = await rerankWithLLM("coffee", candidates);
    expect(result.transactions).toHaveLength(0);
  });

  it("falls back to original candidates on LLM failure", async () => {
    const { rerankWithLLM } = await import("../reranker");

    const candidates = [
      makeRankedTx({ id: "1" }),
      makeRankedTx({ id: "2" }),
      makeRankedTx({ id: "3" }),
      makeRankedTx({ id: "4" }),
    ];

    mockCompletionCreate.mockRejectedValueOnce(new Error("API error"));

    const result = await rerankWithLLM("anything", candidates);
    expect(result.transactions).toHaveLength(4);
  });

  it("skips LLM call for 3 or fewer candidates", async () => {
    const { rerankWithLLM } = await import("../reranker");

    const candidates = [
      makeRankedTx({ id: "1" }),
      makeRankedTx({ id: "2" }),
    ];

    const result = await rerankWithLLM("test", candidates);
    expect(result.transactions).toHaveLength(2);
    expect(mockCompletionCreate).not.toHaveBeenCalled();
  });

  it("returns all candidates for empty result set", async () => {
    const { rerankWithLLM } = await import("../reranker");

    const result = await rerankWithLLM("test", []);
    expect(result.transactions).toHaveLength(0);
  });

  it("handles out-of-range merchant indices by skipping them", async () => {
    const { rerankWithLLM } = await import("../reranker");

    const candidates = [
      makeRankedTx({ id: "1", merchant_name: "Starbucks" }),
      makeRankedTx({ id: "2", merchant_name: "Netflix" }),
      makeRankedTx({ id: "3", merchant_name: "Amazon" }),
      makeRankedTx({ id: "4", merchant_name: "Target" }),
    ];

    // 3 unique merchants: Starbucks, Netflix, Amazon, Target
    // Index 0 and 99 are out of range
    mockCompletionCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({ relevant_merchants: [0, 1, 99] }),
        },
      }],
    });

    const result = await rerankWithLLM("test", candidates);
    // Only merchant index 1 (Starbucks) is valid
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].merchant_name).toBe("Starbucks");
  });

  it("handles string indices from LLM", async () => {
    const { rerankWithLLM } = await import("../reranker");

    const candidates = [
      makeRankedTx({ id: "1", merchant_name: "Starbucks" }),
      makeRankedTx({ id: "2", merchant_name: "Netflix" }),
      makeRankedTx({ id: "3", merchant_name: "Tim Hortons" }),
      makeRankedTx({ id: "4", merchant_name: "Amazon" }),
    ];

    // 4 unique merchants; LLM returns string indices
    mockCompletionCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({ relevant_merchants: ["1", "3"] }),
        },
      }],
    });

    const result = await rerankWithLLM("coffee", candidates);
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0].merchant_name).toBe("Starbucks");
    expect(result.transactions[1].merchant_name).toBe("Tim Hortons");
  });

  it("handles non-array relevant_merchants by returning empty", async () => {
    const { rerankWithLLM } = await import("../reranker");

    const candidates = [
      makeRankedTx({ id: "1" }),
      makeRankedTx({ id: "2" }),
      makeRankedTx({ id: "3" }),
      makeRankedTx({ id: "4" }),
    ];

    mockCompletionCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({ relevant_merchants: "not an array" }),
        },
      }],
    });

    const result = await rerankWithLLM("test", candidates);
    expect(result.transactions).toHaveLength(0);
  });

  it("keeps all transactions when all merchants are selected", async () => {
    const { rerankWithLLM } = await import("../reranker");

    const candidates = [
      makeRankedTx({ id: "1", merchant_name: "Starbucks" }),
      makeRankedTx({ id: "2", merchant_name: "Tim Hortons" }),
      makeRankedTx({ id: "3", merchant_name: "Starbucks" }),
      makeRankedTx({ id: "4", merchant_name: "Tim Hortons" }),
    ];

    // 2 unique merchants, both selected
    mockCompletionCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({ relevant_merchants: [1, 2] }),
        },
      }],
    });

    const result = await rerankWithLLM("coffee", candidates);
    expect(result.transactions).toHaveLength(4);
  });

  it("exactly 3 candidates skips LLM call", async () => {
    const { rerankWithLLM } = await import("../reranker");

    const candidates = [
      makeRankedTx({ id: "1" }),
      makeRankedTx({ id: "2" }),
      makeRankedTx({ id: "3" }),
    ];

    const result = await rerankWithLLM("test", candidates);
    expect(result.transactions).toHaveLength(3);
    expect(mockCompletionCreate).not.toHaveBeenCalled();
  });

  it("4 candidates triggers LLM call", async () => {
    const { rerankWithLLM } = await import("../reranker");

    const candidates = [
      makeRankedTx({ id: "1", merchant_name: "A" }),
      makeRankedTx({ id: "2", merchant_name: "B" }),
      makeRankedTx({ id: "3", merchant_name: "C" }),
      makeRankedTx({ id: "4", merchant_name: "D" }),
    ];

    mockCompletionCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({ relevant_merchants: [1, 2, 3, 4] }),
        },
      }],
    });

    const result = await rerankWithLLM("test", candidates);
    expect(result.transactions).toHaveLength(4);
    expect(mockCompletionCreate).toHaveBeenCalledOnce();
  });
});
