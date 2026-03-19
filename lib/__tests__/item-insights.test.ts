import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabase before importing the module under test
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockGte = vi.fn();

let mockResult: { data: unknown[]; error: null } = { data: [], error: null };

vi.mock("../supabase", () => ({
  getSupabase: () => ({
    from: () => ({
      select: (...args: unknown[]) => {
        mockSelect(...args);
        return {
          eq: (...eqArgs: unknown[]) => {
            mockEq(...eqArgs);
            return {
              gte: (...gteArgs: unknown[]) => {
                mockGte(...gteArgs);
                return mockResult;
              },
            };
          },
        };
      },
    }),
  }),
  getSupabaseAdmin: vi.fn(),
}));

import { detectItemTrends } from "../item-insights";

function setMockData(data: unknown[]) {
  mockResult = { data, error: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResult = { data: [], error: null };
});

describe("detectItemTrends", () => {
  it("returns empty array when no receipts exist", async () => {
    setMockData([]);
    const result = await detectItemTrends("user_123");
    expect(result).toEqual([]);
  });

  it("detects repeat purchases (3+ times)", async () => {
    setMockData([
      { merchant: "Walmart", date: "2026-03-01", line_items: [{ name: "Milk", quantity: 1, total: 4.99, category: "groceries" }] },
      { merchant: "Walmart", date: "2026-03-05", line_items: [{ name: "milk", quantity: 1, total: 5.29, category: "groceries" }] },
      { merchant: "Target", date: "2026-03-10", line_items: [{ name: " Milk ", quantity: 1, total: 4.79, category: "groceries" }] },
    ]);

    const result = await detectItemTrends("user_123");
    expect(result.length).toBeGreaterThanOrEqual(1);
    const repeat = result.find((i) => i.type === "repeat_purchase");
    expect(repeat).toBeDefined();
    expect(repeat!.message).toContain("milk");
    expect(repeat!.message).toContain("3 times");
  });

  it("detects high-spend items (> $50)", async () => {
    setMockData([
      { merchant: "Best Buy", date: "2026-03-01", line_items: [{ name: "AirPods Pro", quantity: 1, total: 249.99, category: "electronics" }] },
    ]);

    const result = await detectItemTrends("user_123");
    const highSpend = result.find((i) => i.type === "high_spend_item");
    expect(highSpend).toBeDefined();
    expect(highSpend!.message).toContain("AirPods Pro");
    expect(highSpend!.message).toContain("Best Buy");
  });

  it("detects merchant sub-category breakdown with 3+ receipts", async () => {
    setMockData([
      { merchant: "Walmart", date: "2026-03-01", line_items: [{ name: "Bananas", quantity: 1, total: 2.50, category: "groceries" }] },
      { merchant: "Walmart", date: "2026-03-05", line_items: [{ name: "Dish Soap", quantity: 1, total: 3.99, category: "household" }] },
      { merchant: "Walmart", date: "2026-03-10", line_items: [{ name: "Bread", quantity: 1, total: 2.99, category: "groceries" }] },
    ]);

    const result = await detectItemTrends("user_123");
    const breakdown = result.find((i) => i.type === "merchant_breakdown");
    expect(breakdown).toBeDefined();
    expect(breakdown!.message).toContain("Walmart");
    expect(breakdown!.message).toMatch(/\d+% groceries/);
  });

  it("returns at most 3 insights", async () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      merchant: "Store",
      date: "2026-03-01",
      line_items: [
        { name: `Item${i}`, quantity: 3, total: 99.99, category: `cat${i}` },
      ],
    }));
    setMockData(items);

    const result = await detectItemTrends("user_123");
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it("handles missing or malformed line_items gracefully", async () => {
    setMockData([
      { merchant: "Store", date: "2026-03-01", line_items: null },
      { merchant: "Store", date: "2026-03-02", line_items: "not an array" },
      { merchant: "Store", date: "2026-03-03", line_items: [{ name: null, total: 10 }] },
    ]);

    const result = await detectItemTrends("user_123");
    // Should not throw, just return empty or gracefully handle
    expect(Array.isArray(result)).toBe(true);
  });
});
