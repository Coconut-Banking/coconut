import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests for POST /api/cards/migrate-token
 *
 * BUG-CRITICAL-1: Missing session ownership check.
 *   The route loaded a card_tool_sessions row by cookie but never verified
 *   that the session's clerk_user_id matched the currently authenticated user.
 *   A second user on the same machine (30-day httpOnly cookie) could have
 *   another Coconut user's Plaid token migrated into their account.
 *
 *   Fix: select clerk_user_id, then reject with 403 when
 *        clerk_user_id IS NOT NULL and does NOT match effectiveUserId.
 *
 *   Sessions created unauthenticated (analyze-plaid) have clerk_user_id = NULL
 *   and are intentionally claimable by any user who holds the cookie.
 */

// ── Mocks ────────────────────────────────────────────────────────────────────

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

vi.mock("@/lib/encryption", () => ({
  decryptToken: vi.fn((t: string) => `decrypted:${t}`),
}));

vi.mock("@/lib/transaction-sync", () => ({
  savePlaidToken: vi.fn().mockResolvedValue(undefined),
  syncTransactionsForUser: vi.fn().mockResolvedValue({ synced: 0 }),
  embedTransactionsForUser: vi.fn().mockResolvedValue(undefined),
  embedRichTransactionsForUser: vi.fn().mockResolvedValue(undefined),
  enrichCategoriesForUser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
}));

vi.mock("@/lib/cached-queries", () => ({
  CACHE_TAGS: {
    transactions: (id: string) => `tx-${id}`,
  },
}));

// next/headers — mock cookies() so the route can read card_session_id
const mockCookieGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: vi.fn(() =>
    Promise.resolve({
      get: mockCookieGet,
    })
  ),
}));

// plaid-client — not needed for ownership-check tests; keep it absent so the
// dynamic import returns null (the route falls back to savePlaidToken directly)
vi.mock("@/lib/plaid-client", () => ({
  getPlaidClient: vi.fn(() => null),
}));

import { loadClerkAuth } from "@/lib/auth";
import { getEffectiveUserId } from "@/lib/demo";
import { rateLimit } from "@/lib/rate-limit";
import { getSupabaseAdmin } from "@/lib/supabase";

const mockLoadClerkAuth = vi.mocked(loadClerkAuth);
const mockGetEffectiveUserId = vi.mocked(getEffectiveUserId);
const mockRateLimit = vi.mocked(rateLimit);
const mockGetSupabaseAdmin = vi.mocked(getSupabaseAdmin);

import { POST } from "../migrate-token/route";

// ── DB mock helpers ───────────────────────────────────────────────────────────

/**
 * Builds a minimal Supabase db mock for the card_tool_sessions table.
 * `sessionRow` is what maybeSingle() resolves to (or null for "not found").
 */
function makeDb(sessionRow: Record<string, unknown> | null) {
  const sessionResult = { data: sessionRow, error: null };

  const sessionSelectQuery = {
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(sessionResult),
  };

  const updateQuery = {
    eq: vi.fn().mockResolvedValue({ data: null, error: null }),
  };

  const plaidItemsQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  };

  const db = {
    from: vi.fn((table: string) => {
      if (table === "card_tool_sessions") {
        return {
          select: vi.fn(() => sessionSelectQuery),
          update: vi.fn(() => updateQuery),
        };
      }
      if (table === "plaid_items") {
        return plaidItemsQuery;
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
    }),
  };
  return db;
}

/** Shared future expiry timestamp (well beyond any test run). */
const FUTURE_EXPIRY = new Date(Date.now() + 1_000_000_000).toISOString();

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  mockLoadClerkAuth.mockResolvedValue({
    ok: true,
    userId: "clerk_attacker",
  } as Awaited<ReturnType<typeof loadClerkAuth>>);

  mockGetEffectiveUserId.mockResolvedValue("effective_attacker");

  mockRateLimit.mockReturnValue({ success: true, remaining: 4 });

  // Default: cookie is present
  mockCookieGet.mockImplementation((name: string) =>
    name === "card_session_id" ? { value: "session-abc" } : undefined
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── BUG-CRITICAL-1 tests ──────────────────────────────────────────────────────

describe("BUG-CRITICAL-1: session ownership check in migrate-token", () => {
  it("returns 403 when the session was created by a different Coconut user (clerk_user_id mismatch)", async () => {
    /**
     * This is the core security test.
     *
     * A session created by "effective_owner" (an authenticated Coconut user)
     * has clerk_user_id = "effective_owner". A different user ("effective_attacker")
     * holds the 30-day cookie and calls this route.
     *
     * OLD code (bug): clerk_user_id was not selected and not checked — the route
     *   would proceed to savePlaidToken and migrate the token into the attacker's
     *   account, returning { ok: true }.
     *
     * FIXED code: clerk_user_id is selected; the mismatch check fires and returns
     *   { ok: false, reason: "session_not_owned" } with HTTP 403.
     */
    const db = makeDb({
      id: "session-abc",
      plaid_access_token: "enc-token",
      plaid_item_id: "item-xyz",
      converted_to_clerk_user_id: null,
      expires_at: FUTURE_EXPIRY,
      clerk_user_id: "effective_owner", // belongs to a DIFFERENT user
    });
    mockGetSupabaseAdmin.mockReturnValue(db as unknown as ReturnType<typeof getSupabaseAdmin>);

    // Current user is the attacker, NOT the owner
    mockGetEffectiveUserId.mockResolvedValue("effective_attacker");

    const res = await POST();

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.reason).toBe("session_not_owned");
  });

  it("allows migration when clerk_user_id is NULL (unauthenticated / analyze-plaid session)", async () => {
    /**
     * Sessions created via the unauthenticated /cards flow (analyze-plaid) have
     * clerk_user_id = NULL. Any authenticated user who holds the cookie should
     * be able to claim and migrate such a session — this is the intended path.
     */
    const db = makeDb({
      id: "session-abc",
      plaid_access_token: "enc-token",
      plaid_item_id: "item-xyz",
      converted_to_clerk_user_id: null,
      expires_at: FUTURE_EXPIRY,
      clerk_user_id: null, // unauthenticated session — claimable by anyone
    });
    mockGetSupabaseAdmin.mockReturnValue(db as unknown as ReturnType<typeof getSupabaseAdmin>);

    mockGetEffectiveUserId.mockResolvedValue("effective_attacker");

    const res = await POST();

    // Must NOT be a 403 — the session is unowned and claimable
    expect(res.status).not.toBe(403);
    // Should succeed
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.item_id).toBe("item-xyz");
  });

  it("allows migration when clerk_user_id matches the current user (same owner)", async () => {
    /**
     * The session belongs to the same user who is calling the route.
     * The ownership check must pass and migration must proceed normally.
     */
    const db = makeDb({
      id: "session-abc",
      plaid_access_token: "enc-token",
      plaid_item_id: "item-xyz",
      converted_to_clerk_user_id: null,
      expires_at: FUTURE_EXPIRY,
      clerk_user_id: "effective_owner", // same as the current user below
    });
    mockGetSupabaseAdmin.mockReturnValue(db as unknown as ReturnType<typeof getSupabaseAdmin>);

    mockGetEffectiveUserId.mockResolvedValue("effective_owner"); // same as session owner

    const res = await POST();

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.item_id).toBe("item-xyz");
  });

  it("returns session_not_owned (403) even when the session has a valid token and has not expired", async () => {
    /**
     * Guards against a subtle regression: make sure the ownership check runs
     * BEFORE the expensive decrypt/savePlaidToken path, not just before expiry.
     * The session is fully valid in every other way — only the user mismatch matters.
     */
    const db = makeDb({
      id: "session-abc",
      plaid_access_token: "enc-token",
      plaid_item_id: "item-xyz",
      converted_to_clerk_user_id: null,
      expires_at: FUTURE_EXPIRY,
      clerk_user_id: "some_other_user",
    });
    mockGetSupabaseAdmin.mockReturnValue(db as unknown as ReturnType<typeof getSupabaseAdmin>);

    mockGetEffectiveUserId.mockResolvedValue("entirely_different_user");

    const res = await POST();

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.reason).toBe("session_not_owned");
  });
});
