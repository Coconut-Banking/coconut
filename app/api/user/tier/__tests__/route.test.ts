import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for GET /api/user/tier — BUG-RESILIENCE-1
 *
 * The old code did not destructure `{ error }` from the Supabase SELECT,
 * so a DB failure would silently return { tier: "free" } with HTTP 200,
 * masking the infrastructure failure entirely.
 *
 * The fix: destructure error and return 500 when it is truthy.
 */

// ── Mocks ─────────────────────────────────────────────────────────────────

vi.mock("@/lib/auth", () => ({
  loadClerkAuth: vi.fn(),
}));

const mockSelectResult = vi.fn();

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => mockSelectResult(),
        }),
      }),
      update: () => ({
        eq: () => Promise.resolve({ error: null }),
      }),
    }),
  }),
}));

import { loadClerkAuth } from "@/lib/auth";

const mockAuth = vi.mocked(loadClerkAuth);

// ── Helpers ────────────────────────────────────────────────────────────────

function authedAs(userId: string) {
  mockAuth.mockResolvedValue({ ok: true, userId, getToken: vi.fn() });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("GET /api/user/tier — BUG-RESILIENCE-1", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue({ ok: true, userId: null, getToken: vi.fn() });
    const { GET } = await import("../route");
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns 503 when Clerk is unavailable", async () => {
    mockAuth.mockResolvedValue({ ok: false, reason: "rate_limited" });
    const { GET } = await import("../route");
    const res = await GET();
    expect(res.status).toBe(503);
  });

  it("returns the user's tier when the SELECT succeeds", async () => {
    authedAs("user_abc");
    mockSelectResult.mockResolvedValue({ data: { tier: "pro" }, error: null });
    const { GET } = await import("../route");
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.tier).toBe("pro");
  });

  it("returns 'free' when the user row has no tier set (null)", async () => {
    authedAs("user_abc");
    mockSelectResult.mockResolvedValue({ data: { tier: null }, error: null });
    const { GET } = await import("../route");
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.tier).toBe("free");
  });

  it("returns 500 when the SELECT returns a DB error (BUG-RESILIENCE-1 regression)", async () => {
    /**
     * This test FAILS against the old code because the old code never checks error,
     * falling through to return { tier: "free" } with 200 even on DB failure.
     * With the fix, error is checked and 500 is returned.
     */
    authedAs("user_abc");
    mockSelectResult.mockResolvedValue({
      data: null,
      error: { message: "connection refused" },
    });
    const { GET } = await import("../route");
    const res = await GET();
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toMatch(/fetch tier/i);
  });

  it("returns 500 for different DB error messages (infrastructure failure)", async () => {
    authedAs("user_xyz");
    mockSelectResult.mockResolvedValue({
      data: null,
      error: { message: "SSL SYSCALL error: EOF detected" },
    });
    const { GET } = await import("../route");
    const res = await GET();
    expect(res.status).toBe(500);
  });
});
