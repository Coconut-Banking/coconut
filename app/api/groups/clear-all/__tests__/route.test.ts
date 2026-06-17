import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for POST /api/groups/clear-all — BUG-RESILIENCE-2
 *
 * The old code did not check the error from the owned-groups SELECT:
 *   const { data: ownedGroups } = await db.from("groups").select("id")...
 * If that SELECT failed, ownedGroups was undefined, ownedIds was [], and group
 * deletion was silently skipped — the route still returned 200 OK, making the
 * user believe their data was cleared when owned groups remained in the DB.
 *
 * The fix: destructure error and return 500 when it is truthy.
 */

// ── Mocks ─────────────────────────────────────────────────────────────────

vi.mock("@clerk/nextjs/server", () => ({
  currentUser: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getUserId: vi.fn(),
}));

const mockOwnedGroupsSelect = vi.fn();
const mockSplitTxSelect = vi.fn();
const mockDeleteCount = vi.fn();

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === "groups") {
        return {
          select: () => ({
            eq: () => mockOwnedGroupsSelect(),
          }),
          delete: () => ({
            eq: () => Promise.resolve({ error: null }),
          }),
        };
      }
      if (table === "split_transactions") {
        return {
          select: () => ({
            eq: () => mockSplitTxSelect(),
          }),
          delete: () => ({
            eq: () => Promise.resolve({ error: null }),
          }),
        };
      }
      // All other tables — safe no-ops for safeDelete and group_members operations
      return {
        delete: (_opts?: unknown) => ({
          eq: () => mockDeleteCount(),
          in: () => Promise.resolve({ error: null }),
        }),
        update: () => ({
          in: () => Promise.resolve({ error: null }),
          eq: () => Promise.resolve({ error: null }),
        }),
        select: () => ({
          eq: () => Promise.resolve({ data: [], error: null }),
        }),
      };
    },
  }),
}));

import { getUserId } from "@/lib/auth";
import { currentUser } from "@clerk/nextjs/server";

const mockGetUserId = vi.mocked(getUserId);
const mockCurrentUser = vi.mocked(currentUser);

// ── Helpers ────────────────────────────────────────────────────────────────

function authedAs(userId: string, email = "user@example.com") {
  mockGetUserId.mockResolvedValue(userId);
  mockCurrentUser.mockResolvedValue({
    emailAddresses: [{ emailAddress: email }],
  } as unknown as Awaited<ReturnType<typeof currentUser>>);
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("POST /api/groups/clear-all — BUG-RESILIENCE-2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: delete on all tables returns count=0
    mockDeleteCount.mockResolvedValue({ count: 0, error: null });
    // Default: split_transactions select returns empty
    mockSplitTxSelect.mockResolvedValue({ data: [], error: null });
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetUserId.mockResolvedValue(null);
    const { POST } = await import("../route");
    const res = await POST();
    expect(res.status).toBe(401);
  });

  it("returns 200 with ok:true when there are no owned groups", async () => {
    authedAs("user_abc");
    mockOwnedGroupsSelect.mockResolvedValue({ data: [], error: null });
    const { POST } = await import("../route");
    const res = await POST();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.deletedGroups).toBe(0);
  });

  it("returns 500 when the owned-groups SELECT returns a DB error (BUG-RESILIENCE-2 regression)", async () => {
    /**
     * This test FAILS against the old code because the old code never checks the
     * error from the groups SELECT. When error is set, ownedGroups is undefined,
     * ownedIds becomes [], and the route returns 200 with deletedGroups=0.
     * With the fix, error is checked and 500 is returned immediately.
     */
    authedAs("user_abc");
    mockOwnedGroupsSelect.mockResolvedValue({
      data: null,
      error: { message: "permission denied for table groups" },
    });
    const { POST } = await import("../route");
    const res = await POST();
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toMatch(/owned groups/i);
  });

  it("returns 500 for network-level DB errors on the groups SELECT", async () => {
    authedAs("user_xyz");
    mockOwnedGroupsSelect.mockResolvedValue({
      data: null,
      error: { message: "connection timeout" },
    });
    const { POST } = await import("../route");
    const res = await POST();
    expect(res.status).toBe(500);
  });
});
