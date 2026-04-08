import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for POST /api/email-receipts/rematch
 *
 * Regression test for BUG-RESILIENCE-1:
 *   after.total was using beforeTotal instead of actual post-rematch count,
 *   so before.total always equalled after.total even when the record count changed.
 */

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@/lib/demo", () => ({
  getEffectiveUserId: vi.fn(),
}));

vi.mock("@/lib/receipt-matcher", () => ({
  auditAndRematchAllReceipts: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  getSupabase: vi.fn(),
}));

import { getEffectiveUserId } from "@/lib/demo";
import { auditAndRematchAllReceipts } from "@/lib/receipt-matcher";
import { getSupabase } from "@/lib/supabase";

const mockGetUserId = vi.mocked(getEffectiveUserId);
const mockRematch = vi.mocked(auditAndRematchAllReceipts);
const mockGetSupabase = vi.mocked(getSupabase);

// ── Helper: build a chainable Supabase query stub ─────────────────────────

/**
 * Builds a minimal Supabase stub that cycles through countSequence on each
 * .from() call, letting us return different counts for each query in order:
 *   call 0 → beforeMatched
 *   call 1 → beforeTotal
 *   call 2 → afterMatched
 *   call 3 → afterUnmatched
 */
function makeSupabaseStub(countSequence: (number | null)[]) {
  let callIndex = 0;

  const makeQuery = (count: number | null) => {
    const query: Record<string, unknown> = {};
    // Every chaining method returns the same query object
    const chain = () => query;
    query.select = chain;
    query.eq = chain;
    query.not = chain;
    query.is = chain;
    // Make the query thenable so `await query` resolves to { count }
    query.then = (
      resolve: (v: { count: number | null }) => void,
      _reject?: unknown
    ) => {
      resolve({ count });
      return Promise.resolve({ count });
    };
    return query;
  };

  return {
    from: () => {
      const count = countSequence[callIndex++] ?? null;
      return makeQuery(count);
    },
  } as unknown as ReturnType<typeof getSupabase>;
}

// ── Import the route once (mocks are already hoisted) ─────────────────────
// We import after vi.mock declarations so the module uses our mocks.
import { POST } from "../rematch/route";

// ── Tests ──────────────────────────────────────────────────────────────────

describe("POST /api/email-receipts/rematch — BUG-RESILIENCE-1", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUserId.mockResolvedValue("user_test_123");
    mockRematch.mockResolvedValue({ cleared: 1, matched: 2 });
  });

  it("after.total reflects post-rematch count, not beforeTotal", async () => {
    /**
     * Scenario:
     *   Before: 3 matched, 10 total
     *   After:  10 matched, 2 unmatched  →  afterTotal should be 12
     *
     * Bug: old code set after.total = beforeTotal = 10.
     * Fix: after.total = afterMatched(10) + afterUnmatched(2) = 12.
     *
     * Query order inside the route:
     *   call 0 → beforeMatched  = 3
     *   call 1 → beforeTotal    = 10
     *   call 2 → afterMatched   = 10
     *   call 3 → afterUnmatched = 2
     */
    mockGetSupabase.mockReturnValue(makeSupabaseStub([3, 10, 10, 2]));

    const res = await POST();
    const json = await res.json();

    expect(json.before.total).toBe(10);
    expect(json.after.total).toBe(12); // 10 + 2, NOT beforeTotal (10)
    expect(json.after.total).not.toBe(json.before.total);
  });

  it("after.total equals before.total when record count is unchanged", async () => {
    /**
     * Scenario: no receipts were added or deleted, just re-matched.
     *   Before: 2 matched, 5 total
     *   After:  3 matched, 2 unmatched  →  afterTotal should be 5
     *
     * Query order:
     *   call 0 → beforeMatched  = 2
     *   call 1 → beforeTotal    = 5
     *   call 2 → afterMatched   = 3
     *   call 3 → afterUnmatched = 2
     */
    mockGetSupabase.mockReturnValue(makeSupabaseStub([2, 5, 3, 2]));

    const res = await POST();
    const json = await res.json();

    expect(json.before.total).toBe(5);
    expect(json.after.total).toBe(5); // 3 + 2
  });

  it("returns 401 when user is not authenticated", async () => {
    mockGetUserId.mockResolvedValue(null);

    const res = await POST();
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  });

  it("includes cleared and matched from auditAndRematchAllReceipts in response", async () => {
    /**
     * Query order:
     *   call 0 → beforeMatched  = 5
     *   call 1 → beforeTotal    = 20
     *   call 2 → afterMatched   = 12
     *   call 3 → afterUnmatched = 8
     */
    mockGetSupabase.mockReturnValue(makeSupabaseStub([5, 20, 12, 8]));
    mockRematch.mockResolvedValue({ cleared: 3, matched: 7 });

    const res = await POST();
    const json = await res.json();

    expect(json.cleared).toBe(3);
    expect(json.matched).toBe(7);
    expect(json.after.matched).toBe(12);
    expect(json.after.total).toBe(20); // 12 + 8
  });
});
