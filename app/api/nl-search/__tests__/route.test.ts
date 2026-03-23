import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/demo", () => ({
  getEffectiveUserId: vi.fn().mockResolvedValue("user_test_123"),
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn().mockReturnValue({ success: true }),
}));
vi.mock("@/lib/search-engine", () => ({
  search: vi.fn().mockResolvedValue({
    transactions: [{ id: "1", merchant_name: "Progeny Coffee", amount: -7.5, date: "2026-03-10" }],
    answer: "You spent $7.50 on coffee/cafes between 2026-02-10 and 2026-03-11 across 1 transaction.",
    metric: "sum",
    total: 7.5,
    count: 1,
    breakdown: null,
    topMerchants: null,
    usedVectorFallback: false,
  }),
}));

describe("POST /api/nl-search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("compiles and exports POST", async () => {
    const mod = await import("../route");
    expect(mod.POST).toBeDefined();
  });

  it("returns search result when q provided", async () => {
    const { search } = await import("@/lib/search-engine");
    const mod = await import("../route");
    const req = new Request("http://localhost/api/nl-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: "how much did I spend on coffee" }),
    });

    const res = await mod.POST(req as never);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.transactions).toHaveLength(1);
    expect(data.answer).toContain("coffee/cafes");
    expect(data.total).toBe(7.5);
    expect(search).toHaveBeenCalledWith("user_test_123", "how much did I spend on coffee", {
      debug: false,
    });
  });

  it("returns empty when q is empty", async () => {
    const mod = await import("../route");
    const req = new Request("http://localhost/api/nl-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: "   " }),
    });

    const res = await mod.POST(req as never);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.transactions).toEqual([]);
    expect(data.answer).toBe("");
  });
});
