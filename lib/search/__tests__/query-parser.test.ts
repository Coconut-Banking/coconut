import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

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

describe("parseQuery", () => {
  it("parses a merchant query with date range", async () => {
    const { parseQuery } = await import("../query-parser");

    mockCompletionCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            date_start: "2026-03-09",
            date_end: "2026-03-15",
            amount_min: null,
            amount_max: null,
            semantic_terms: "Starbucks coffee",
            merchant_search: "Starbucks",
            intent: "search",
          }),
        },
      }],
    });

    const result = await parseQuery("Starbucks last week");

    expect(result.merchant_search).toBe("Starbucks");
    expect(result.semantic_terms).toBe("Starbucks coffee");
    expect(result.structured_filters.date_range).toEqual({
      start: "2026-03-09",
      end: "2026-03-15",
    });
    expect(result.intent).toBe("search");
  });

  it("parses an aggregate query", async () => {
    const { parseQuery } = await import("../query-parser");

    mockCompletionCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            date_start: "2026-03-01",
            date_end: "2026-03-18",
            semantic_terms: "food dining restaurants",
            merchant_search: null,
            intent: "aggregate",
          }),
        },
      }],
    });

    const result = await parseQuery("how much did I spend on food this month");
    expect(result.intent).toBe("aggregate");
    expect(result.merchant_search).toBeUndefined();
    expect(result.semantic_terms).toContain("food");
  });

  it("parses amount filters", async () => {
    const { parseQuery } = await import("../query-parser");

    mockCompletionCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            date_start: null,
            date_end: null,
            amount_min: -50,
            amount_max: null,
            semantic_terms: "Amazon purchases shopping",
            merchant_search: "Amazon",
            intent: "search",
          }),
        },
      }],
    });

    const result = await parseQuery("Amazon purchases over $50");
    expect(result.structured_filters.amount_range?.min).toBe(-50);
    expect(result.merchant_search).toBe("Amazon");
  });

  it("falls back to default on LLM failure", async () => {
    const { parseQuery } = await import("../query-parser");

    mockCompletionCreate.mockRejectedValueOnce(new Error("API error"));

    const result = await parseQuery("coffee shops");
    expect(result.semantic_terms).toBe("coffee shops");
    expect(result.intent).toBe("search");
  });

  it("falls back to default when LLM returns invalid JSON", async () => {
    const { parseQuery } = await import("../query-parser");

    mockCompletionCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "not json" } }],
    });

    const result = await parseQuery("some query");
    expect(result.semantic_terms).toBe("some query");
    expect(result.intent).toBe("search");
  });

  it("swaps reversed date range (date_start > date_end)", async () => {
    const { parseQuery } = await import("../query-parser");

    mockCompletionCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            date_start: "2026-03-15",
            date_end: "2026-03-01",
            semantic_terms: "test",
            intent: "search",
          }),
        },
      }],
    });

    const result = await parseQuery("test");
    expect(result.structured_filters.date_range).toEqual({
      start: "2026-03-01",
      end: "2026-03-15",
    });
  });

  it("swaps reversed amount range (amount_min > amount_max)", async () => {
    const { parseQuery } = await import("../query-parser");

    mockCompletionCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            amount_min: -10,
            amount_max: -50,
            semantic_terms: "test",
            intent: "search",
          }),
        },
      }],
    });

    const result = await parseQuery("test");
    expect(result.structured_filters.amount_range?.min).toBe(-50);
    expect(result.structured_filters.amount_range?.max).toBe(-10);
  });

  it("rejects invalid date format strings", async () => {
    const { parseQuery } = await import("../query-parser");

    mockCompletionCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            date_start: "invalid",
            date_end: "also-invalid",
            semantic_terms: "test",
            intent: "search",
          }),
        },
      }],
    });

    const result = await parseQuery("test");
    expect(result.structured_filters.date_range).toBeUndefined();
  });

  it("parses transaction_type correctly", async () => {
    const { parseQuery } = await import("../query-parser");

    mockCompletionCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            semantic_terms: "refunds credits returns",
            transaction_type: "refund",
            intent: "search",
          }),
        },
      }],
    });

    const result = await parseQuery("refunds");
    expect(result.structured_filters.transaction_type).toBe("refund");
  });

  it("parses is_pending filter", async () => {
    const { parseQuery } = await import("../query-parser");

    mockCompletionCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            semantic_terms: "pending transactions",
            is_pending: true,
            intent: "search",
          }),
        },
      }],
    });

    const result = await parseQuery("pending transactions");
    expect(result.structured_filters.is_pending).toBe(true);
  });

  it("falls back semantic_terms to original query when LLM returns empty string", async () => {
    const { parseQuery } = await import("../query-parser");

    mockCompletionCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            semantic_terms: "",
            intent: "search",
          }),
        },
      }],
    });

    const result = await parseQuery("Starbucks");
    expect(result.semantic_terms).toBe("Starbucks");
  });

  it("ignores invalid intent values and defaults to search", async () => {
    const { parseQuery } = await import("../query-parser");

    mockCompletionCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            semantic_terms: "test",
            intent: "invalid_intent",
          }),
        },
      }],
    });

    const result = await parseQuery("test");
    expect(result.intent).toBe("search");
  });

  it("handles null LLM response content", async () => {
    const { parseQuery } = await import("../query-parser");

    mockCompletionCreate.mockResolvedValueOnce({
      choices: [{ message: { content: null } }],
    });

    const result = await parseQuery("test query");
    expect(result.semantic_terms).toBe("test query");
    expect(result.intent).toBe("search");
  });

  it("handles empty choices array", async () => {
    const { parseQuery } = await import("../query-parser");

    mockCompletionCreate.mockResolvedValueOnce({ choices: [] });

    const result = await parseQuery("test query");
    expect(result.semantic_terms).toBe("test query");
  });

  it("trims whitespace-only merchant_search to undefined", async () => {
    const { parseQuery } = await import("../query-parser");

    mockCompletionCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            semantic_terms: "food",
            merchant_search: "   ",
            intent: "search",
          }),
        },
      }],
    });

    const result = await parseQuery("food");
    expect(result.merchant_search).toBeUndefined();
  });
});
