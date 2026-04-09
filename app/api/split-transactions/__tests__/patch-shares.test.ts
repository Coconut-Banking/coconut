/**
 * PATCH /api/split-transactions/:id uses update_split_transaction RPC.
 * RPC failures (Postgres errors or logical errors in the returned jsonb) must
 * not return ok:true — the client should see an error status and message.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const TEST_USER_ID = "user_patch_shares_test";
const SPLIT_ID = "split_abc123";
const GROUP_ID = "group_xyz";

// ─── Auth mock ────────────────────────────────────────────────────────────────
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: TEST_USER_ID }),
}));

// ─── group-access mock (DELETE path still uses canAccessGroup) ────────────────
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

// ─── Supabase mock ────────────────────────────────────────────────────────────
let rpcError: { message: string } | null = null;
let rpcResult: Record<string, unknown> | null = null;

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({
    rpc: async (_name: string, _params: unknown) => {
      if (rpcError) return { data: null, error: rpcError };
      return {
        data: rpcResult ?? { ok: true, id: SPLIT_ID, groupId: GROUP_ID },
        error: null,
      };
    },
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
              maybeSingle: async () => ({
                data: { payer_member_id: "member_1" },
                error: null,
              }),
            }),
          }),
          delete: () => ({
            eq: () => Promise.resolve({ data: null, error: null }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({ data: null, error: { message: "not found" } }),
            maybeSingle: async () => ({ data: null, error: null }),
          }),
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
  return new NextRequest(`http://localhost/api/split-transactions/${splitId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe("PATCH /api/split-transactions/:id — RPC error handling", () => {
  beforeEach(() => {
    vi.resetModules();
    rpcError = null;
    rpcResult = null;
  });

  it("returns ok:true when RPC succeeds", async () => {
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
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.id).toBe(SPLIT_ID);
  });

  it("returns 500 when PostgREST reports an RPC failure (e.g. constraint violation)", async () => {
    rpcError = { message: "foreign key constraint violation" };

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

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.ok).toBeUndefined();
    expect(json.error).toBeDefined();
    expect(typeof json.error).toBe("string");
  });

  it("returns 400 when RPC returns a validation error in jsonb", async () => {
    rpcResult = { error: "Invalid member IDs in shares" };

    const { PATCH } = await import("../[id]/route");
    const req = makePatchRequest(SPLIT_ID, {
      shares: [{ memberId: "bad_member", amount: 10 }],
    });

    const res = await PATCH(req, {
      params: Promise.resolve({ id: SPLIT_ID }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid member IDs in shares");
  });
});
