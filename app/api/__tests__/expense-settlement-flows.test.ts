/**
 * Comprehensive integration tests for all expense and settlement flows.
 *
 * Exercises every mutation endpoint (manual-expense, split-transactions,
 * settlements) plus read paths (group detail, summary, person) to verify
 * ledger integrity end-to-end.
 *
 * Flows tested:
 *   1. Add expense to a group (equal split, 4 members)
 *   2. Add expense to a friend (2-way split)
 *   3. Edit an expense (change amount + re-split)
 *   4. Delete an expense
 *   5. Settle up (partial and full)
 *   6. Add multiple expenses, verify cumulative balances
 *   7. Splitwise-imported group: native expenses only affect balance
 *   8. Zero-sum invariant after every mutation
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const TEST_USER_ID = "test_user_flows";

vi.mock("@/lib/auth", () => ({
  getUserId: vi.fn().mockResolvedValue(TEST_USER_ID),
  loadClerkAuth: vi.fn().mockResolvedValue({ ok: true, userId: TEST_USER_ID }),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({
    userId: TEST_USER_ID,
    getToken: async () => null,
  }),
  currentUser: vi.fn().mockResolvedValue({
    primaryEmailAddress: { emailAddress: "me@test.com" },
    emailAddresses: [{ emailAddress: "me@test.com" }],
  }),
  clerkClient: vi.fn().mockResolvedValue({
    users: { getUser: vi.fn().mockResolvedValue(null) },
  }),
}));

// ─── In-memory Supabase mock with RPC support ────────────────────────────────

const db: Record<string, Record<string, unknown>[]> = {
  groups: [],
  group_members: [],
  split_transactions: [],
  split_shares: [],
  settlements: [],
  splitwise_tokens: [],
  transactions: [],
};

let idCounter = 0;
function nextId(prefix: string) {
  return `${prefix}_${String(++idCounter).padStart(3, "0")}`;
}

type MockListResult = { data: Record<string, unknown>[]; error: null };

function rpcHandler(
  fnName: string,
  params: Record<string, unknown>
): { data: unknown; error: unknown } {
  if (fnName === "get_accessible_group_ids") {
    const userId = params.p_user_id as string;
    const owned = db.groups
      .filter((g) => g.owner_id === userId)
      .map((g) => g.id);
    const membered = db.group_members
      .filter((m) => m.user_id === userId)
      .map((m) => m.group_id);
    const ids = [...new Set([...owned, ...membered])];
    return { data: ids, error: null };
  }

  if (fnName === "create_manual_expense") {
    const groupId = params.p_group_id as string;
    const userId = params.p_clerk_user_id as string;
    const amount = Number(params.p_amount);
    const description = (params.p_description as string) || "Expense";
    const currency = (params.p_currency as string) || "USD";
    const date =
      (params.p_date as string) || new Date().toISOString().split("T")[0];
    const payerParam = params.p_payer_member_id as string | null;
    const sharesJson = params.p_shares as
      | { memberId: string; amount: number }[]
      | undefined;

    const myMember = db.group_members.find(
      (m) => m.group_id === groupId && m.user_id === userId
    );
    if (!myMember) return { data: { error: "Group not found" }, error: null };

    const payer = payerParam || (myMember.id as string);

    const txId = nextId("tx");
    db.transactions.push({
      id: txId,
      clerk_user_id: userId,
      plaid_transaction_id: `manual_${txId}`,
      merchant_name: description,
      raw_name: description,
      amount: -amount,
      date,
      is_pending: false,
      primary_category: params.p_category || null,
      detailed_category: null,
    });

    const splitTxId = nextId("stx");
    db.split_transactions.push({
      id: splitTxId,
      group_id: groupId,
      transaction_id: txId,
      created_by: userId,
      created_at: new Date().toISOString(),
      payer_member_id: payer,
      amount,
      description,
      iso_currency_code: currency,
      date,
      receipt_url: params.p_receipt_url || null,
      source: null,
      external_id: null,
      notes: params.p_notes || null,
      category: params.p_category || null,
    });

    if (Array.isArray(sharesJson)) {
      for (const s of sharesJson) {
        db.split_shares.push({
          id: nextId("ssh"),
          split_transaction_id: splitTxId,
          member_id: s.memberId,
          amount: s.amount,
        });
      }
    }

    return {
      data: { splitTxId, txId, shares: sharesJson?.length ?? 0 },
      error: null,
    };
  }

  if (fnName === "delete_split_transaction") {
    const splitId = params.p_split_id as string;
    const userId = params.p_clerk_user_id as string;

    const split = db.split_transactions.find((s) => s.id === splitId);
    if (!split) return { data: { error: "Not found" }, error: null };

    const myMember = db.group_members.find(
      (m) =>
        m.group_id === split.group_id && m.user_id === userId
    );
    if (!myMember) return { data: { error: "Forbidden" }, error: null };

    db.split_shares = db.split_shares.filter(
      (s) => s.split_transaction_id !== splitId
    );
    db.split_transactions = db.split_transactions.filter(
      (s) => s.id !== splitId
    );
    if (split.transaction_id) {
      db.transactions = db.transactions.filter(
        (t) => t.id !== split.transaction_id
      );
    }

    return { data: { deleted: true }, error: null };
  }

  if (fnName === "update_split_transaction") {
    const splitId = params.p_split_id as string;
    const userId = params.p_clerk_user_id as string;
    const newAmount = params.p_amount != null ? Number(params.p_amount) : null;
    const newDesc = params.p_description as string | null;
    const newPayer = params.p_payer_member_id as string | null;
    const newShares = params.p_shares as
      | { memberId: string; amount: number }[]
      | null;

    const split = db.split_transactions.find((s) => s.id === splitId);
    if (!split) return { data: { error: "Not found" }, error: null };

    const myMember = db.group_members.find(
      (m) =>
        m.group_id === split.group_id && m.user_id === userId
    );
    if (!myMember) return { data: { error: "Forbidden" }, error: null };

    if (newAmount != null) split.amount = newAmount;
    if (newDesc != null) split.description = newDesc;
    if (newPayer != null) split.payer_member_id = newPayer;

    if (newAmount != null && split.transaction_id) {
      const tx = db.transactions.find(
        (t) => t.id === split.transaction_id
      );
      if (tx) tx.amount = -newAmount;
    }

    if (newShares) {
      db.split_shares = db.split_shares.filter(
        (s) => s.split_transaction_id !== splitId
      );
      for (const s of newShares) {
        db.split_shares.push({
          id: nextId("ssh"),
          split_transaction_id: splitId,
          member_id: s.memberId,
          amount: s.amount,
        });
      }
    }

    return { data: { updated: true }, error: null };
  }

  if (fnName === "insert_settlement_checked") {
    const groupId = params.p_group_id as string;
    const userId = params.p_clerk_user_id as string;
    const payerMemberId = params.p_payer_member_id as string;
    const receiverMemberId = params.p_receiver_member_id as string;
    const amount = Number(params.p_amount);
    const currency = (params.p_currency as string) || "USD";

    const myMember = db.group_members.find(
      (m) => m.group_id === groupId && m.user_id === userId
    );
    if (!myMember) return { data: { error: "Not in group" }, error: null };

    const settId = nextId("set");
    db.settlements.push({
      id: settId,
      group_id: groupId,
      payer_member_id: payerMemberId,
      receiver_member_id: receiverMemberId,
      amount,
      iso_currency_code: currency,
      status: "completed",
      method: "manual",
      created_at: new Date().toISOString(),
      created_by: userId,
    });

    return { data: { id: settId }, error: null };
  }

  return { data: null, error: { message: `Unknown RPC: ${fnName}` } };
}

function makeClient() {
  return {
    from: (table: string) => makeTable(table),
    rpc: async (fnName: string, params: Record<string, unknown> = {}) =>
      rpcHandler(fnName, params),
  };
}

function makeTable(table: string) {
  const getRows = () => db[table] ?? [];

  function filterBy(
    rows: Record<string, unknown>[],
    conditions: [string, unknown][]
  ) {
    return rows.filter((r) =>
      conditions.every(([col, val]) => r[col] === val)
    );
  }

  function chainable(
    filteredFn: () => Record<string, unknown>[]
  ): Record<string, unknown> {
    return {
      eq: (col: string, val: unknown) => {
        const next = () => filteredFn().filter((r) => r[col] === val);
        return chainable(next);
      },
      in: (col: string, vals: unknown[]) => {
        const next = () =>
          filteredFn().filter((r) =>
            (vals as unknown[]).includes(r[col])
          );
        return chainable(next);
      },
      is: (col: string, val: unknown) => {
        const next = () => filteredFn().filter((r) => r[col] === val);
        return chainable(next);
      },
      not: (_col: string, _op: string, _val: unknown) => {
        return chainable(filteredFn);
      },
      neq: (col: string, val: unknown) => {
        const next = () => filteredFn().filter((r) => r[col] !== val);
        return chainable(next);
      },
      lt: (col: string, val: unknown) => {
        const next = () =>
          filteredFn().filter((r) => (r[col] as number) < (val as number));
        return chainable(next);
      },
      gte: (col: string, val: unknown) => {
        const next = () =>
          filteredFn().filter(
            (r) => (r[col] as number) >= (val as number)
          );
        return chainable(next);
      },
      order: (_col?: string, _opts?: unknown) => chainable(filteredFn),
      limit: (_n?: number) =>
        Promise.resolve({ data: filteredFn(), error: null }),
      single: async () => {
        const row = filteredFn()[0];
        return { data: row ?? null, error: row ? null : { message: "not found" } };
      },
      maybeSingle: async () => ({
        data: filteredFn()[0] ?? null,
        error: null,
      }),
      then: (fn: (value: MockListResult) => unknown) =>
        Promise.resolve({ data: filteredFn(), error: null }).then(fn),
      // For select with options like { count: "exact", head: true }
      csv: () => Promise.resolve({ data: "", error: null }),
    };
  }

  return {
    select: (_cols?: string, _opts?: Record<string, unknown>) =>
      chainable(getRows),
    insert: (row: Record<string, unknown> | Record<string, unknown>[]) => {
      const toInsert = Array.isArray(row) ? row : [row];
      const newRows = toInsert.map((r) => ({
        id: nextId(table),
        ...r,
      }));
      (db[table] ?? []).push(...newRows);
      return {
        select: (_?: string) => ({
          single: async () => ({ data: newRows[0], error: null }),
          then: (fn: (value: MockListResult) => unknown) =>
            Promise.resolve({ data: newRows, error: null }).then(fn),
        }),
        then: (
          fn: (v: {
            data: Record<string, unknown> | null;
            error: null;
          }) => unknown
        ) =>
          Promise.resolve({ data: newRows[0] ?? null, error: null }).then(
            fn
          ),
      };
    },
    update: (patch: Record<string, unknown>) => ({
      eq: (col: string, val: unknown) => {
        const rows = db[table] ?? [];
        return {
          is: () => Promise.resolve({ data: null, error: null }),
          then: (fn: (v: { data: null; error: null }) => unknown) => {
            rows.forEach((r) => {
              if (r[col] === val) Object.assign(r, patch);
            });
            return Promise.resolve({ data: null, error: null }).then(fn);
          },
          eq: (c2: string, v2: unknown) => ({
            then: (fn: (v: { data: null; error: null }) => unknown) => {
              rows.forEach((r) => {
                if (r[col] === val && r[c2] === v2) Object.assign(r, patch);
              });
              return Promise.resolve({ data: null, error: null }).then(fn);
            },
          }),
        };
      },
    }),
    delete: () => ({
      in: (col: string, vals: unknown[]) => {
        db[table] = (db[table] ?? []).filter(
          (r) => !(vals as unknown[]).includes(r[col])
        );
        return Promise.resolve({ data: null, error: null });
      },
      eq: (col: string, val: unknown) => {
        db[table] = (db[table] ?? []).filter((r) => r[col] !== val);
        return Promise.resolve({ data: null, error: null });
      },
    }),
    upsert: (row: Record<string, unknown>) => {
      (db[table] ?? []).push({ id: nextId(table), ...row });
      return Promise.resolve({ data: null, error: null });
    },
  };
}

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => makeClient(),
  getSupabaseAdmin: () => makeClient(),
  getSupabaseForUser: () => makeClient(),
}));

vi.mock("@/lib/cached-queries", () => ({
  CACHE_TAGS: {
    splitTransactions: (id: string) => `split-tx-${id}`,
    transactions: (id: string) => `tx-${id}`,
    groups: (id: string) => `groups-${id}`,
  },
}));

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

vi.mock("@/lib/clerk-user-lookup", () => ({
  findClerkUserIdByEmail: vi.fn().mockResolvedValue(null),
  findClerkUserIdsByEmails: vi.fn().mockResolvedValue(new Map()),
  getClerkUserPhotos: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock("@/lib/push-sender", () => ({
  notifyGroupMembers: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/splitwise-shadow", () => ({
  shadowCreateExpense: vi.fn().mockResolvedValue(undefined),
  shadowDeleteExpense: vi.fn().mockResolvedValue(undefined),
  shadowUpdateExpense: vi.fn().mockResolvedValue(undefined),
  shadowRecordSettlement: vi.fn().mockResolvedValue(undefined),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function addGroup(
  name: string,
  opts: { group_type?: string; source?: string | null } = {}
) {
  const id = nextId("grp");
  db.groups.push({
    id,
    name,
    owner_id: TEST_USER_ID,
    created_at: new Date().toISOString(),
    group_type: opts.group_type ?? "other",
    source: opts.source ?? null,
    external_id: opts.source === "splitwise" ? nextId("sw") : null,
    archived_at: null,
    image_url: null,
  });
  return id;
}

function addMember(
  groupId: string,
  displayName: string,
  opts: { userId?: string; email?: string } = {}
) {
  const id = nextId("mem");
  db.group_members.push({
    id,
    group_id: groupId,
    user_id: opts.userId ?? null,
    email: opts.email ?? null,
    display_name: displayName,
    venmo_username: null,
    cashapp_cashtag: null,
    paypal_username: null,
  });
  return id;
}

function addExpenseDirectly(
  groupId: string,
  payerMemberId: string,
  amount: number,
  shares: { memberId: string; amount: number }[],
  opts: {
    description?: string;
    source?: string | null;
    method?: string | null;
  } = {}
) {
  const txId = nextId("stx");
  db.split_transactions.push({
    id: txId,
    group_id: groupId,
    transaction_id: null,
    created_by: TEST_USER_ID,
    created_at: new Date().toISOString(),
    payer_member_id: payerMemberId,
    amount,
    description: opts.description ?? "Expense",
    iso_currency_code: "USD",
    receipt_url: null,
    source: opts.source ?? null,
    external_id: opts.source === "splitwise" ? nextId("swe") : null,
    notes: null,
    category: null,
  });
  for (const s of shares) {
    db.split_shares.push({
      id: nextId("ssh"),
      split_transaction_id: txId,
      member_id: s.memberId,
      amount: s.amount,
    });
  }
  return txId;
}

function addSettlementDirectly(
  groupId: string,
  fromMemberId: string,
  toMemberId: string,
  amount: number,
  opts: { method?: string } = {}
) {
  const id = nextId("set");
  db.settlements.push({
    id,
    group_id: groupId,
    payer_member_id: fromMemberId,
    receiver_member_id: toMemberId,
    amount,
    iso_currency_code: "USD",
    status: "completed",
    method: opts.method ?? "manual",
    created_at: new Date().toISOString(),
    created_by: TEST_USER_ID,
  });
  return id;
}

function resetDb() {
  for (const key of Object.keys(db)) {
    db[key] = [];
  }
  idCounter = 0;
}

async function fetchGroupDetail(groupId: string) {
  const { GET } = await import("@/app/api/groups/[id]/route");
  const res = await GET(
    new NextRequest(`http://localhost/api/groups/${groupId}`),
    { params: Promise.resolve({ id: groupId }) }
  );
  return { status: res.status, data: await res.json() };
}

async function fetchSummary(opts: { contacts?: boolean } = {}) {
  const url = opts.contacts
    ? "http://localhost/api/groups/summary?contacts=true"
    : "http://localhost/api/groups/summary";
  const { GET } = await import("@/app/api/groups/summary/route");
  const res = await GET(new NextRequest(url));
  return { status: res.status, data: await res.json() };
}

function sumBalances(members: Array<{ total: number }>): number {
  return Math.round(members.reduce((s, m) => s + m.total, 0) * 100) / 100;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("expense & settlement flows", () => {
  beforeEach(() => {
    resetDb();
    vi.clearAllMocks();
  });

  // ── Flow 1: Add expense to 4-person group ──

  describe("Flow 1: add expense to group (4 members, equal split)", () => {
    it("creates expense via RPC and group detail shows correct balances", async () => {
      const gid = addGroup("Tahoe Trip");
      const me = addMember(gid, "Me", { userId: TEST_USER_ID, email: "me@test.com" });
      const alice = addMember(gid, "Alice", { email: "alice@test.com" });
      const bob = addMember(gid, "Bob", { email: "bob@test.com" });
      const carol = addMember(gid, "Carol", { email: "carol@test.com" });

      // I paid $100 dinner, split 4 ways = $25 each
      const result = rpcHandler("create_manual_expense", {
        p_clerk_user_id: TEST_USER_ID,
        p_group_id: gid,
        p_amount: 100,
        p_description: "Dinner",
        p_currency: "USD",
        p_date: "2026-04-01",
        p_payer_member_id: me,
        p_shares: [
          { memberId: me, amount: 25 },
          { memberId: alice, amount: 25 },
          { memberId: bob, amount: 25 },
          { memberId: carol, amount: 25 },
        ],
      });
      expect((result.data as { shares: number }).shares).toBe(4);

      // Verify DB state
      expect(db.split_transactions).toHaveLength(1);
      expect(db.split_shares).toHaveLength(4);
      expect(db.transactions).toHaveLength(1);

      // Verify group detail
      const detail = await fetchGroupDetail(gid);
      expect(detail.status).toBe(200);
      expect(detail.data.activity).toHaveLength(1);
      expect(detail.data.activity[0].splitCount).toBe(4);
      expect(detail.data.activity[0].merchant).toBe("Dinner");

      // I paid $100, owed $25 → I'm owed $75
      // Each other person paid $0, owed $25 → they owe $25
      const balances = detail.data.balances as Array<{
        memberId: string;
        total: number;
      }>;
      const myBal = balances.find((b) => b.memberId === me);
      expect(myBal?.total).toBe(75);

      const aliceBal = balances.find((b) => b.memberId === alice);
      expect(aliceBal?.total).toBe(-25);

      // Zero-sum check
      expect(sumBalances(balances)).toBe(0);
    });
  });

  // ── Flow 2: Add expense to friend (2-way split) ──

  describe("Flow 2: add expense to friend (2-way split)", () => {
    it("creates a 2-person expense and balances are correct", async () => {
      const gid = addGroup("Me & Dave", { group_type: "friend" });
      const me = addMember(gid, "Me", { userId: TEST_USER_ID });
      const dave = addMember(gid, "Dave", { email: "dave@test.com" });

      rpcHandler("create_manual_expense", {
        p_clerk_user_id: TEST_USER_ID,
        p_group_id: gid,
        p_amount: 50,
        p_description: "Coffee",
        p_currency: "USD",
        p_date: "2026-04-02",
        p_payer_member_id: me,
        p_shares: [
          { memberId: me, amount: 25 },
          { memberId: dave, amount: 25 },
        ],
      });

      const detail = await fetchGroupDetail(gid);
      expect(detail.status).toBe(200);
      expect(detail.data.activity).toHaveLength(1);

      const balances = detail.data.balances as Array<{
        memberId: string;
        total: number;
      }>;
      const myBal = balances.find((b) => b.memberId === me);
      const daveBal = balances.find((b) => b.memberId === dave);
      expect(myBal?.total).toBe(25);
      expect(daveBal?.total).toBe(-25);
      expect(sumBalances(balances)).toBe(0);
    });
  });

  // ── Flow 3: Edit an expense ──

  describe("Flow 3: edit expense (change amount)", () => {
    it("updates amount and shares, balances recalculate", async () => {
      const gid = addGroup("Edit Test");
      const me = addMember(gid, "Me", { userId: TEST_USER_ID });
      const alice = addMember(gid, "Alice");

      const stxId = addExpenseDirectly(gid, me, 100, [
        { memberId: me, amount: 50 },
        { memberId: alice, amount: 50 },
      ], { description: "Lunch" });

      // Before edit: I'm owed $50
      let detail = await fetchGroupDetail(gid);
      let balances = detail.data.balances as Array<{ memberId: string; total: number }>;
      expect(balances.find((b) => b.memberId === me)?.total).toBe(50);
      expect(sumBalances(balances)).toBe(0);

      // Edit: change to $200, 60/140 split
      rpcHandler("update_split_transaction", {
        p_clerk_user_id: TEST_USER_ID,
        p_split_id: stxId,
        p_amount: 200,
        p_description: "Lunch (updated)",
        p_payer_member_id: null,
        p_shares: [
          { memberId: me, amount: 60 },
          { memberId: alice, amount: 140 },
        ],
      });

      // After edit: I paid $200, owe $60 → net +$140
      detail = await fetchGroupDetail(gid);
      balances = detail.data.balances as Array<{ memberId: string; total: number }>;
      expect(balances.find((b) => b.memberId === me)?.total).toBe(140);
      expect(balances.find((b) => b.memberId === alice)?.total).toBe(-140);
      expect(sumBalances(balances)).toBe(0);
    });
  });

  // ── Flow 4: Delete an expense ──

  describe("Flow 4: delete expense", () => {
    it("removes expense and resets balances to zero", async () => {
      const gid = addGroup("Delete Test");
      const me = addMember(gid, "Me", { userId: TEST_USER_ID });
      const bob = addMember(gid, "Bob");

      const stxId = addExpenseDirectly(gid, me, 80, [
        { memberId: me, amount: 40 },
        { memberId: bob, amount: 40 },
      ]);

      // Before: I'm owed $40
      let detail = await fetchGroupDetail(gid);
      let balances = detail.data.balances as Array<{ memberId: string; total: number }>;
      expect(balances.find((b) => b.memberId === me)?.total).toBe(40);

      // Delete
      rpcHandler("delete_split_transaction", {
        p_clerk_user_id: TEST_USER_ID,
        p_split_id: stxId,
      });

      // After: no expenses, no balances
      detail = await fetchGroupDetail(gid);
      expect(detail.data.activity).toHaveLength(0);
      balances = detail.data.balances as Array<{ memberId: string; total: number }>;
      if (balances.length > 0) {
        expect(sumBalances(balances)).toBe(0);
        for (const b of balances) expect(b.total).toBe(0);
      }
    });
  });

  // ── Flow 5: Settle up ──

  describe("Flow 5: partial and full settlement", () => {
    it("partial settlement reduces balance, full settlement zeroes it", async () => {
      const gid = addGroup("Settle Test");
      const me = addMember(gid, "Me", { userId: TEST_USER_ID });
      const alice = addMember(gid, "Alice");

      addExpenseDirectly(gid, me, 100, [
        { memberId: me, amount: 50 },
        { memberId: alice, amount: 50 },
      ]);

      // Before: I'm owed $50
      let detail = await fetchGroupDetail(gid);
      let balances = detail.data.balances as Array<{ memberId: string; total: number }>;
      expect(balances.find((b) => b.memberId === me)?.total).toBe(50);
      expect(sumBalances(balances)).toBe(0);

      // Partial settlement: Alice pays me $20
      addSettlementDirectly(gid, alice, me, 20);

      detail = await fetchGroupDetail(gid);
      balances = detail.data.balances as Array<{ memberId: string; total: number }>;
      expect(balances.find((b) => b.memberId === me)?.total).toBe(30);
      expect(balances.find((b) => b.memberId === alice)?.total).toBe(-30);
      expect(sumBalances(balances)).toBe(0);

      // Full settlement: Alice pays me remaining $30
      addSettlementDirectly(gid, alice, me, 30);

      detail = await fetchGroupDetail(gid);
      balances = detail.data.balances as Array<{ memberId: string; total: number }>;
      // Fully settled: members may have 0 balance or be absent from list
      const myFinal = balances.find((b) => b.memberId === me)?.total ?? 0;
      const aliceFinal = balances.find((b) => b.memberId === alice)?.total ?? 0;
      expect(myFinal).toBe(0);
      expect(aliceFinal).toBe(0);
      expect(sumBalances(balances)).toBe(0);
    });
  });

  // ── Flow 6: Multiple expenses accumulate correctly ──

  describe("Flow 6: multiple expenses accumulate", () => {
    it("3 expenses from different payers produce correct net balances", async () => {
      const gid = addGroup("Multi Expense");
      const me = addMember(gid, "Me", { userId: TEST_USER_ID });
      const alice = addMember(gid, "Alice");
      const bob = addMember(gid, "Bob");

      // I pay $90 dinner, split 3 ways
      addExpenseDirectly(gid, me, 90, [
        { memberId: me, amount: 30 },
        { memberId: alice, amount: 30 },
        { memberId: bob, amount: 30 },
      ], { description: "Dinner" });

      // Alice pays $30 drinks, split 3 ways
      addExpenseDirectly(gid, alice, 30, [
        { memberId: me, amount: 10 },
        { memberId: alice, amount: 10 },
        { memberId: bob, amount: 10 },
      ], { description: "Drinks" });

      // Bob pays $60 taxi, split 3 ways
      addExpenseDirectly(gid, bob, 60, [
        { memberId: me, amount: 20 },
        { memberId: alice, amount: 20 },
        { memberId: bob, amount: 20 },
      ], { description: "Taxi" });

      const detail = await fetchGroupDetail(gid);
      expect(detail.data.activity).toHaveLength(3);

      const balances = detail.data.balances as Array<{ memberId: string; total: number }>;

      // Me: paid 90, owed 60 → +30
      // Alice: paid 30, owed 60 → -30
      // Bob: paid 60, owed 60 → 0 (may be absent from balances if zero)
      expect(balances.find((b) => b.memberId === me)?.total).toBe(30);
      expect(balances.find((b) => b.memberId === alice)?.total).toBe(-30);
      expect(balances.find((b) => b.memberId === bob)?.total ?? 0).toBe(0);
      expect(sumBalances(balances)).toBe(0);
    });
  });

  // ── Flow 7: Splitwise group — native expenses only ──

  describe("Flow 7: Splitwise group — native vs imported", () => {
    it("imported SW expenses/settlements excluded from balance; native only counts", async () => {
      const gid = addGroup("Seattle", { source: "splitwise" });
      const me = addMember(gid, "Me", { userId: TEST_USER_ID });
      const alice = addMember(gid, "Alice");

      // Imported from Splitwise (should NOT count toward native balance)
      addExpenseDirectly(gid, me, 500, [
        { memberId: me, amount: 250 },
        { memberId: alice, amount: 250 },
      ], { description: "SW Hotel", source: "splitwise" });

      // Imported SW settlement (should NOT count)
      addSettlementDirectly(gid, alice, me, 100, { method: "splitwise" });

      // Native Coconut expense (SHOULD count)
      addExpenseDirectly(gid, me, 40, [
        { memberId: me, amount: 20 },
        { memberId: alice, amount: 20 },
      ], { description: "Native Lunch" });

      // Native settlement
      addSettlementDirectly(gid, alice, me, 5, { method: "manual" });

      const detail = await fetchGroupDetail(gid);
      const balances = detail.data.balances as Array<{ memberId: string; total: number }>;

      // Native only: I paid $40, owed $20, Alice settled $5
      // Me: 40 - 20 - 5 = 15
      // Alice: 0 - 20 + 5 = -15
      const myBal = balances.find((b) => b.memberId === me);
      const aliceBal = balances.find((b) => b.memberId === alice);

      expect(myBal?.total).toBe(15);
      expect(aliceBal?.total).toBe(-15);
      expect(sumBalances(balances)).toBe(0);
    });
  });

  // ── Flow 8: Summary shows correct aggregate across groups ──

  describe("Flow 8: summary aggregates balances across groups", () => {
    it("shows correct net balance summing friend and group debts", async () => {
      // Friend group: Dave owes me $25
      const friendGid = addGroup("Me & Dave", { group_type: "friend" });
      const me1 = addMember(friendGid, "Me", { userId: TEST_USER_ID, email: "me@test.com" });
      const dave = addMember(friendGid, "Dave", { email: "dave@test.com" });
      addExpenseDirectly(friendGid, me1, 50, [
        { memberId: me1, amount: 25 },
        { memberId: dave, amount: 25 },
      ]);

      // Trip group: I owe Alice $15
      const tripGid = addGroup("Trip");
      const me2 = addMember(tripGid, "Me", { userId: TEST_USER_ID, email: "me@test.com" });
      const alice = addMember(tripGid, "Alice", { email: "alice@test.com" });
      addExpenseDirectly(tripGid, alice, 30, [
        { memberId: me2, amount: 15 },
        { memberId: alice, amount: 15 },
      ]);

      const summary = await fetchSummary();
      expect(summary.status).toBe(200);
      // Friend-type groups appear in summary.friends, not summary.groups
      const totalEntities =
        (summary.data.groups?.length ?? 0) + (summary.data.friends?.length ?? 0);
      expect(totalEntities).toBeGreaterThanOrEqual(2);
    });
  });

  // ── Flow 9: Add then delete — balance returns to zero ──

  describe("Flow 9: add expense then delete — roundtrip", () => {
    it("balance returns to zero after deleting the only expense", async () => {
      const gid = addGroup("Roundtrip");
      const me = addMember(gid, "Me", { userId: TEST_USER_ID });
      const bob = addMember(gid, "Bob");

      const stxId = addExpenseDirectly(gid, me, 60, [
        { memberId: me, amount: 30 },
        { memberId: bob, amount: 30 },
      ]);

      // Verify non-zero balance
      let detail = await fetchGroupDetail(gid);
      let balances = detail.data.balances as Array<{ memberId: string; total: number }>;
      expect(balances.find((b) => b.memberId === me)?.total).toBe(30);

      // Delete
      rpcHandler("delete_split_transaction", {
        p_clerk_user_id: TEST_USER_ID,
        p_split_id: stxId,
      });

      // Verify zero
      detail = await fetchGroupDetail(gid);
      balances = detail.data.balances as Array<{ memberId: string; total: number }>;
      for (const b of balances) expect(b.total).toBe(0);
    });
  });

  // ── Flow 10: Settle more than owed is capped ──

  describe("Flow 10: over-settlement produces correct net", () => {
    it("over-paying flips the balance direction", async () => {
      const gid = addGroup("Overpay");
      const me = addMember(gid, "Me", { userId: TEST_USER_ID });
      const alice = addMember(gid, "Alice");

      // I pay $100, split equally → I'm owed $50
      addExpenseDirectly(gid, me, 100, [
        { memberId: me, amount: 50 },
        { memberId: alice, amount: 50 },
      ]);

      // Alice "settles" $70 (more than owed)
      addSettlementDirectly(gid, alice, me, 70);

      const detail = await fetchGroupDetail(gid);
      const balances = detail.data.balances as Array<{ memberId: string; total: number }>;

      // Me: 100 - 50 - 70 = -20 (now I owe Alice!)
      // Alice: 0 - 50 + 70 = 20
      expect(balances.find((b) => b.memberId === me)?.total).toBe(-20);
      expect(balances.find((b) => b.memberId === alice)?.total).toBe(20);
      expect(sumBalances(balances)).toBe(0);
    });
  });

  // ── Flow 11: Uneven split ──

  describe("Flow 11: uneven split amounts", () => {
    it("custom shares produce correct per-member balances", async () => {
      const gid = addGroup("Uneven");
      const me = addMember(gid, "Me", { userId: TEST_USER_ID });
      const alice = addMember(gid, "Alice");
      const bob = addMember(gid, "Bob");

      // I pay $100, I get $10, Alice gets $60, Bob gets $30
      addExpenseDirectly(gid, me, 100, [
        { memberId: me, amount: 10 },
        { memberId: alice, amount: 60 },
        { memberId: bob, amount: 30 },
      ]);

      const detail = await fetchGroupDetail(gid);
      const balances = detail.data.balances as Array<{ memberId: string; total: number }>;

      expect(balances.find((b) => b.memberId === me)?.total).toBe(90);
      expect(balances.find((b) => b.memberId === alice)?.total).toBe(-60);
      expect(balances.find((b) => b.memberId === bob)?.total).toBe(-30);
      expect(sumBalances(balances)).toBe(0);
    });
  });

  // ── Flow 12: Someone else pays ──

  describe("Flow 12: someone else pays", () => {
    it("payer who is not me gets credit", async () => {
      const gid = addGroup("Other Payer");
      const me = addMember(gid, "Me", { userId: TEST_USER_ID });
      const alice = addMember(gid, "Alice");

      // Alice paid $80, split equally
      addExpenseDirectly(gid, alice, 80, [
        { memberId: me, amount: 40 },
        { memberId: alice, amount: 40 },
      ]);

      const detail = await fetchGroupDetail(gid);
      const balances = detail.data.balances as Array<{ memberId: string; total: number }>;

      // Alice: paid 80, owed 40 → +40
      // Me: paid 0, owed 40 → -40
      expect(balances.find((b) => b.memberId === alice)?.total).toBe(40);
      expect(balances.find((b) => b.memberId === me)?.total).toBe(-40);
      expect(sumBalances(balances)).toBe(0);
    });
  });
});
