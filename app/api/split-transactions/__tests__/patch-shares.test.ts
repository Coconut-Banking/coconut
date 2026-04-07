/**
 * BUG-CRITICAL-1: Silent share insert failure on PATCH expense
 *
 * PATCH /api/split-transactions/:id returned ok:true even when the
 * split_shares insert failed (e.g. foreign-key or constraint violation).
 * The fix destructures `{ error }` from the insert and returns 500 on failure,
 * matching the pattern already used in the POST route.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const TEST_USER_ID = "user_patch_shares_test";
const SPLIT_ID = "split_abc123";
const GROUP_ID = "group_xyz";
const MEMBER_IDS = ["member_1", "member_2"];

// ─── Auth mock ────────────────────────────────────────────────────────────────
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: TEST_USER_ID }),
}));

// ─── group-access mock ────────────────────────────────────────────────────────
vi.mock("@/lib/group-access", () => ({
  canAccessGroup: vi.fn().mockResolvedValue(true),
}));

// ─── Cache mocks ──────────────────────────────────────────────────────────────
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
vi.mock("@/lib/cached-queries", () => ({
  CACHE_TAGS: {
    splitTransactions: (id: string) => `split-tx-${id}`,
    transactions: (id: string) => `tx-${id}`,
  },
}));

// ─── expense-shares mock ──────────────────────────────────────────────────────
vi.mock("@/lib/expense-shares", () => ({
  toCents: (n: number) => Math.round(n * 100),
}));

// ─── Supabase mock (controlled per-test via sharesInsertError) ────────────────
//
// We control whether the split_shares insert returns an error.
// `sharesInsertError` is set before each test to simulate success or failure.
let sharesInsertError: { message: string } | null = null;

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({
    from: (table: string) => {
      if (table === "split_transactions") {
        return {
          select: (_cols?: string) => ({
            eq: (_col: string, _val: unknown) => ({
              single: async () => ({
                data: {
                  id: SPLIT_ID,
                  group_id: GROUP_ID,
                  transaction_id: null,
                  payer_member_id: "member_1",
                },
                error: null,
              }),
              // Used by getExistingAmount when transaction_id is null
              maybeSingle: async () => ({
                data: { amount: -50 },
                error: null,
              }),
            }),
          }),
          update: (_patch: unknown) => ({
            eq: (_col: string, _val: unknown) =>
              Promise.resolve({ data: null, error: null }),
          }),
        };
      }

      if (table === "group_members") {
        return {
          select: (_cols?: string) => ({
            eq: (_col: string, _val: unknown) =>
              Promise.resolve({
                data: MEMBER_IDS.map((id) => ({
                  id,
                  user_id: null,
                  display_name: id,
                })),
                error: null,
              }),
          }),
        };
      }

      if (table === "split_shares") {
        return {
          delete: () => ({
            eq: (_col: string, _val: unknown) =>
              Promise.resolve({ data: null, error: null }),
          }),
          insert: (_rows: unknown) =>
            Promise.resolve({ data: null, error: sharesInsertError }),
        };
      }

      // Fallback
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: null,
              error: { message: "not found" },
            }),
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
        update: () => ({
          eq: () => Promise.resolve({ data: null, error: null }),
        }),
        delete: () => ({
          eq: () => Promise.resolve({ data: null, error: null }),
        }),
        insert: () => Promise.resolve({ data: null, error: null }),
      };
    },
  }),
}));

// ─── Helper ───────────────────────────────────────────────────────────────────
function makePatchRequest(splitId: string, body: unknown) {
  return new NextRequest(
    `http://localhost/api/split-transactions/${splitId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe("PATCH /api/split-transactions/:id — share insert error handling", () => {
  beforeEach(() => {
    vi.resetModules();
    sharesInsertError = null;
  });

  it("returns ok:true when shares insert succeeds", async () => {
    sharesInsertError = null;

    const { PATCH } = await import("../[id]/route");
    // amount + shares must sum correctly: 30 + 20 = 50
    const req = makePatchRequest(SPLIT_ID, {
      amount: 50,
      shares: [
        { memberId: "member_1", amount: 30 },
        { memberId: "member_2", amount: 20 },
      ],
    });

    const res = await PATCH(req, {
      params: Promise.resolve({ id: SPLIT_ID }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.id).toBe(SPLIT_ID);
  });

  it("returns 500 (not ok:true) when shares insert fails — demonstrates BUG-CRITICAL-1", async () => {
    sharesInsertError = { message: "foreign key constraint violation" };

    const { PATCH } = await import("../[id]/route");
    const req = makePatchRequest(SPLIT_ID, {
      amount: 50,
      shares: [
        { memberId: "member_1", amount: 30 },
        { memberId: "member_2", amount: 20 },
      ],
    });

    const res = await PATCH(req, {
      params: Promise.resolve({ id: SPLIT_ID }),
    });

    // Before the fix this returned 200 with ok:true — a silent failure.
    // After the fix it must return 500 with an error field.
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.ok).toBeUndefined();
    expect(json.error).toBeDefined();
    expect(typeof json.error).toBe("string");
  });
});
