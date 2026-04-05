/**
 * BUG-RESILIENCE-1: split_shares insert failure must rollback split_transaction
 *
 * Before the fix the error from split_shares.insert was ignored, the route
 * returned HTTP 200 with split.id, and the split_transaction row was left
 * orphaned with no shares — silent data inconsistency.
 *
 * After the fix the route deletes the orphaned split_transaction and returns
 * HTTP 500 so callers know the operation failed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const TEST_USER_ID = "user_resilience_1";
const GROUP_ID = "group_resilience_1";
const TRANSACTION_ID = "tx_resilience_1";
const MEMBER_ID = "member_resilience_1";

// ── Auth ────────────────────────────────────────────────────────────────────
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: TEST_USER_ID }),
}));

// ── Dependencies that are not under test ─────────────────────────────────────
vi.mock("@/lib/group-access", () => ({
  canAccessGroup: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/push-sender", () => ({
  notifyGroupMembers: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

vi.mock("@/lib/cached-queries", () => ({
  CACHE_TAGS: {
    splitTransactions: (id: string) => `split-tx-${id}`,
  },
}));

vi.mock("@/lib/currency", () => ({
  formatCurrency: (n: number) => `$${n.toFixed(2)}`,
}));

vi.mock("@/lib/expense-shares", () => ({
  toCents: (n: number) => Math.round(n * 100),
}));

// ── In-memory Supabase mock ────────────────────────────────────────────────
type Row = Record<string, unknown>;

let splitTransactionsStore: Row[] = [];
let splitSharesStore: Row[] = [];
let sharesInsertShouldFail = false;

function makeSupabaseClient() {
  return {
    from: (table: string) => {
      if (table === "group_members") {
        return {
          select: () => ({
            eq: () => Promise.resolve({
              data: [{ id: MEMBER_ID, user_id: TEST_USER_ID, display_name: "Me", email: "me@test.com" }],
              error: null,
            }),
          }),
        };
      }

      if (table === "transactions") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    id: TRANSACTION_ID,
                    amount: -50,
                    clerk_user_id: TEST_USER_ID,
                    iso_currency_code: "USD",
                    merchant_name: "Coffee Shop",
                    raw_name: "COFFEE SHOP",
                  },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }

      if (table === "split_transactions") {
        return {
          select: (_cols?: string) => ({
            eq: (col: string, val: unknown) => ({
              eq: (c2: string, v2: unknown) => ({
                maybeSingle: async () => ({
                  data: splitTransactionsStore.find(r => r[col] === val && r[c2] === v2) ?? null,
                  error: null,
                }),
                // race-condition check: .eq().eq().order() — route awaits this
                order: (_orderCol: unknown, _opts?: unknown) =>
                  Promise.resolve({
                    data: splitTransactionsStore.filter(r => r[col] === val && r[c2] === v2),
                    error: null,
                  }),
              }),
            }),
          }),
          insert: (row: Row) => {
            const newRow = { id: `split_${Math.random().toString(36).slice(2)}`, ...row };
            splitTransactionsStore.push(newRow);
            return {
              select: () => ({
                single: async () => ({ data: newRow, error: null }),
              }),
            };
          },
          delete: () => ({
            eq: (col: string, val: unknown) => {
              splitTransactionsStore = splitTransactionsStore.filter(r => r[col] !== val);
              return Promise.resolve({ data: null, error: null });
            },
          }),
        };
      }

      if (table === "split_shares") {
        return {
          insert: (_rows: Row[]) => {
            if (sharesInsertShouldFail) {
              return Promise.resolve({ data: null, error: { message: "foreign key violation" } });
            }
            splitSharesStore.push(...(Array.isArray(_rows) ? _rows : [_rows]));
            return Promise.resolve({ data: null, error: null });
          },
        };
      }

      // fallback
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        insert: () => Promise.resolve({ data: null, error: null }),
        delete: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
      };
    },
  };
}

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => makeSupabaseClient(),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/split-transactions", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const validBody = {
  groupId: GROUP_ID,
  transactionId: TRANSACTION_ID,
  shares: [{ memberId: MEMBER_ID, amount: 50 }],
};

// ── Tests ──────────────────────────────────────────────────────────────────────
describe("BUG-RESILIENCE-1: split_shares insert failure", () => {
  beforeEach(() => {
    splitTransactionsStore = [];
    splitSharesStore = [];
    sharesInsertShouldFail = false;
  });

  it("returns HTTP 200 when split_shares insert succeeds", async () => {
    const { POST } = await import("../route");
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBeDefined();
    expect(splitTransactionsStore).toHaveLength(1);
    expect(splitSharesStore).toHaveLength(1);
  });

  it("returns HTTP 500 when split_shares insert fails (bug: was HTTP 200)", async () => {
    sharesInsertShouldFail = true;
    const { POST } = await import("../route");
    const res = await POST(makeRequest(validBody));
    // Before the fix this was 200 — the bug was silent data loss.
    expect(res.status).toBe(500);
  });

  it("rolls back split_transaction when split_shares insert fails", async () => {
    sharesInsertShouldFail = true;
    const { POST } = await import("../route");
    await POST(makeRequest(validBody));
    // The orphaned split_transaction must be deleted on failure.
    expect(splitTransactionsStore).toHaveLength(0);
  });

  it("error response body contains an error message on shares failure", async () => {
    sharesInsertShouldFail = true;
    const { POST } = await import("../route");
    const res = await POST(makeRequest(validBody));
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });
});
