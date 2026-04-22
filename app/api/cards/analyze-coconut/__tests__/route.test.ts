import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests for POST /api/cards/analyze-coconut
 *
 * BUG-CRITICAL-1: DB amounts must be negated before passing to categorizeTransactions().
 *   Coconut DB stores expenses as NEGATIVE (e.g. -50 for a $50 charge).
 *   categorizeTransactions() skips amounts <= 0. Without negation, all spend is filtered
 *   out and the returned spend_summary is all zeros.
 *
 * BUG-RESILIENCE-1: .update() result must destructure { error } and return HTTP 500 on failure.
 *   Without this, a DB update failure silently returns HTTP 200 with stale spend data.
 */

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/lib/auth", () => ({
  loadClerkAuth: vi.fn(),
}));

vi.mock("@/lib/demo", () => ({
  getEffectiveUserId: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { loadClerkAuth } from "@/lib/auth";
import { getEffectiveUserId } from "@/lib/demo";
import { rateLimit } from "@/lib/rate-limit";
import { getSupabaseAdmin } from "@/lib/supabase";

const mockLoadClerkAuth = vi.mocked(loadClerkAuth);
const mockGetEffectiveUserId = vi.mocked(getEffectiveUserId);
const mockRateLimit = vi.mocked(rateLimit);
const mockGetSupabaseAdmin = vi.mocked(getSupabaseAdmin);

import { POST } from "../route";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Builds a chainable Supabase query mock that resolves to `result`. */
function makeQuery(result: unknown) {
  const q: Record<string, unknown> = {};
  const chain = [
    "select", "eq", "is", "gte", "lte", "not", "order",
    "limit", "in", "update", "insert", "maybeSingle", "single",
  ];
  chain.forEach((method) => {
    q[method] = vi.fn(() => q);
  });
  // Terminal calls that should resolve
  (q["maybeSingle"] as ReturnType<typeof vi.fn>).mockResolvedValue(result);
  (q["single"] as ReturnType<typeof vi.fn>).mockResolvedValue(result);
  // Allow .limit(), .lte() etc. to also resolve (for the transactions fetch)
  (q["limit"] as ReturnType<typeof vi.fn>).mockResolvedValue(result);
  return q;
}

/**
 * Build a minimal Supabase db mock where:
 *  - `transactions` table returns the provided rows
 *  - `accounts` / `credit_cards` / `plaid_items` return empty arrays (no card detection)
 *  - `card_tool_sessions` behaves as specified by `sessionOpts`
 */
function makeDb(opts: {
  transactions: Array<{
    amount: number;
    primary_category: string | null;
    detailed_category: string | null;
    merchant_name: string | null;
    raw_name: string | null;
  }>;
  existingSession?: { id: string } | null;
  updateError?: { message: string } | null;
  insertResult?: { data: { id: string } | null; error: { message: string } | null };
}) {
  const {
    transactions,
    existingSession = null,
    updateError = null,
    insertResult = { data: { id: "new-session-id" }, error: null },
  } = opts;

  // Build per-table behaviour
  const txQuery = makeQuery({ data: transactions, error: null });

  const accountsQuery = makeQuery({ data: [], error: null });
  const creditCardsQuery = makeQuery({ data: [], error: null });
  const plaidItemsQuery = makeQuery({ data: [], error: null });

  // card_tool_sessions — maybeSingle returns existing session (or null)
  const sessionSelectQuery = makeQuery({ data: existingSession, error: null });

  // card_tool_sessions — update: route does .update({}).eq("id", id)
  // .eq() is the terminal call — mock it to resolve with { error }
  const updateQuery = makeQuery({ data: null, error: updateError });
  (updateQuery["eq"] as ReturnType<typeof vi.fn>).mockResolvedValue({ data: null, error: updateError });

  // card_tool_sessions — insert
  const insertQuery = makeQuery(insertResult);
  (insertQuery["select"] as ReturnType<typeof vi.fn>).mockReturnValue(insertQuery);
  (insertQuery["single"] as ReturnType<typeof vi.fn>).mockResolvedValue(insertResult);

  const db = {
    from: vi.fn((table: string) => {
      if (table === "transactions") return txQuery;
      if (table === "accounts") return accountsQuery;
      if (table === "credit_cards") return creditCardsQuery;
      if (table === "plaid_items") return plaidItemsQuery;
      if (table === "card_tool_sessions") {
        // Return different sub-mocks for select vs update vs insert
        return {
          select: vi.fn(() => sessionSelectQuery),
          update: vi.fn(() => updateQuery),
          insert: vi.fn(() => insertQuery),
        };
      }
      return makeQuery({ data: null, error: null });
    }),
  };
  return db;
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockLoadClerkAuth.mockResolvedValue({
    ok: true,
    userId: "clerk_user_test",
  } as Awaited<ReturnType<typeof loadClerkAuth>>);

  mockGetEffectiveUserId.mockResolvedValue("effective_user_test");

  mockRateLimit.mockReturnValue({ success: true, remaining: 9, reset: Date.now() + 60_000 });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── BUG-CRITICAL-1 tests ─────────────────────────────────────────────────────

describe("BUG-CRITICAL-1: DB amounts negated before categorization", () => {
  it("produces non-zero dining spend when DB returns negative amounts", async () => {
    /**
     * This test FAILS against the old code (amount: tx.amount) because
     * categorizeTransactions() skips amounts <= 0, so all DB expense rows
     * (stored as negatives) are filtered and spend_summary is all zeros.
     *
     * With the fix (amount: -(tx.amount)), the negated positive value passes
     * the guard and dining spend is correctly counted.
     */
    const db = makeDb({
      transactions: [
        {
          amount: -60,
          primary_category: "FOOD_AND_DRINK",
          detailed_category: "RESTAURANTS",
          merchant_name: "Burger Place",
          raw_name: "BURGER PLACE",
        },
      ],
    });
    mockGetSupabaseAdmin.mockReturnValue(db as ReturnType<typeof getSupabaseAdmin>);

    const res = await POST();
    expect(res.status).toBe(200);
    const json = await res.json();

    // With 3 months analyzed and $60 total dining, monthly average = $20
    expect(json.spend_summary.dining).toBeGreaterThan(0);
    expect(json.spend_summary.dining).toBe(20); // 60 / 3 months
  });

  it("produces all-zero spend when DB returns zero-amount transactions (no negation involved)", async () => {
    // Baseline: zero amounts should still produce zero spend regardless
    const db = makeDb({
      transactions: [
        {
          amount: 0,
          primary_category: "FOOD_AND_DRINK",
          detailed_category: "RESTAURANTS",
          merchant_name: null,
          raw_name: null,
        },
      ],
    });
    mockGetSupabaseAdmin.mockReturnValue(db as ReturnType<typeof getSupabaseAdmin>);

    const res = await POST();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.spend_summary.dining).toBe(0);
  });

  it("correctly classifies multiple negative-amount DB rows across categories", async () => {
    /**
     * Verifies that negation works for all categories, not just dining.
     * Old code: all filtered → all zeros.
     * Fixed code: negated → correct monthly averages.
     */
    const db = makeDb({
      transactions: [
        { amount: -300, primary_category: "FOOD_AND_DRINK", detailed_category: "RESTAURANTS", merchant_name: null, raw_name: null },
        { amount: -150, primary_category: "GROCERIES", detailed_category: "SUPERMARKET", merchant_name: null, raw_name: null },
        { amount: -600, primary_category: "TRAVEL", detailed_category: "AIRLINES", merchant_name: null, raw_name: null },
      ],
    });
    mockGetSupabaseAdmin.mockReturnValue(db as ReturnType<typeof getSupabaseAdmin>);

    const res = await POST();
    const json = await res.json();

    // 3-month window → divide totals by 3
    expect(json.spend_summary.dining).toBe(100);   // 300 / 3
    expect(json.spend_summary.groceries).toBe(50); // 150 / 3
    expect(json.spend_summary.travel).toBe(200);   // 600 / 3
  });

  it("session_id is present in response when spend profile is non-zero", async () => {
    const db = makeDb({
      transactions: [
        { amount: -90, primary_category: "FOOD_AND_DRINK", detailed_category: "RESTAURANTS", merchant_name: null, raw_name: null },
      ],
    });
    mockGetSupabaseAdmin.mockReturnValue(db as ReturnType<typeof getSupabaseAdmin>);

    const res = await POST();
    const json = await res.json();
    expect(json.session_id).toBeDefined();
    expect(typeof json.session_id).toBe("string");
  });
});

// ── BUG-RESILIENCE-1 tests ───────────────────────────────────────────────────

describe("BUG-RESILIENCE-1: DB update error surfaces as HTTP 500", () => {
  it("returns 500 when the card_tool_sessions update fails", async () => {
    /**
     * This test FAILS against the old code because the old code does `await db.update()`
     * without destructuring { error }, so updateError is never checked and the route
     * returns HTTP 200 as if everything succeeded.
     *
     * With the fix (destructure { error: updateError } and return 500 on truthy),
     * this correctly returns 500.
     */
    const db = makeDb({
      transactions: [
        { amount: -50, primary_category: "FOOD_AND_DRINK", detailed_category: "RESTAURANTS", merchant_name: null, raw_name: null },
      ],
      existingSession: { id: "existing-session-abc" },
      updateError: { message: "DB connection timeout" },
    });
    mockGetSupabaseAdmin.mockReturnValue(db as ReturnType<typeof getSupabaseAdmin>);

    const res = await POST();
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("Failed to update session");
  });

  it("returns 200 when the card_tool_sessions update succeeds", async () => {
    // Confirms the success path is unaffected by the fix
    const db = makeDb({
      transactions: [
        { amount: -50, primary_category: "FOOD_AND_DRINK", detailed_category: "RESTAURANTS", merchant_name: null, raw_name: null },
      ],
      existingSession: { id: "existing-session-abc" },
      updateError: null, // no error
    });
    mockGetSupabaseAdmin.mockReturnValue(db as ReturnType<typeof getSupabaseAdmin>);

    const res = await POST();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.session_id).toBe("existing-session-abc");
  });

  it("returns 200 via insert path when no existing session and insert succeeds", async () => {
    // Verifies insert path (no existing session) is unaffected
    const db = makeDb({
      transactions: [
        { amount: -30, primary_category: "GROCERIES", detailed_category: "SUPERMARKET", merchant_name: null, raw_name: null },
      ],
      existingSession: null,
      insertResult: { data: { id: "brand-new-session" }, error: null },
    });
    mockGetSupabaseAdmin.mockReturnValue(db as ReturnType<typeof getSupabaseAdmin>);

    const res = await POST();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.session_id).toBe("brand-new-session");
  });
});
