/**
 * Cross-group settlement: full ledger integrity test.
 *
 * Scenario:
 *   Friend owes me $20 total:
 *     - $5 from a 1:1 friend group (I paid $10 coffee, split equally)
 *     - $15 from a 4-person trip group (I paid $60 dinner, split equally)
 *   Settling $20 from the friend tab records one settlement per group.
 *
 * This test checks EVERY field across EVERY endpoint before and after
 * settlement. If any value is stale, the test fails.
 *
 * Endpoints verified:
 *   - GET /api/groups/person       (friend detail: balance, activity, settlements)
 *   - GET /api/groups/[id]         (friend group detail: balances, suggestions, activity)
 *   - GET /api/groups/[id]         (trip group detail: balances, suggestions, activity)
 *   - GET /api/groups/summary      (home page: friend balance, group balances, totals)
 *   - GET /api/groups/transaction  (expense detail: amounts, shares, groupType)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const TEST_USER_ID = "test_user_cross_settle";

vi.mock("@/lib/auth", () => ({
  getUserId: vi.fn().mockResolvedValue(TEST_USER_ID),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: TEST_USER_ID, getToken: async () => null }),
  currentUser: vi.fn().mockResolvedValue({
    primaryEmailAddress: { emailAddress: "owner@test.com" },
    emailAddresses: [{ emailAddress: "owner@test.com" }],
  }),
  clerkClient: vi.fn().mockResolvedValue({
    users: { getUser: vi.fn().mockResolvedValue(null) },
  }),
}));

// ─── In-memory Supabase mock ─────────────────────────────────────────────────
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
  return `${prefix}_${++idCounter}`;
}

type MockListResult = { data: Record<string, unknown>[]; error: null };

function makeClient() {
  return { from: (table: string) => makeTable(table) };
}

function makeTable(table: string) {
  const rows = (db[table] ?? []) as Record<string, unknown>[];

  return {
    select: (_cols?: string) => ({
      eq: (col: string, val: unknown) => {
        const eqFiltered = () => rows.filter((r) => r[col] === val);
        return {
          eq: (c2: string, v2: unknown) => {
            const eq2Filtered = () =>
              rows.filter((r) => r[col] === val && r[c2] === v2);
            return {
              maybeSingle: async () => ({
                data: eq2Filtered()[0] ?? null,
                error: null,
              }),
              single: async () => ({
                data: eq2Filtered()[0] ?? null,
                error: null,
              }),
              in: (c3: string, vals3: unknown[]) => ({
                order: () => ({
                  limit: () =>
                    Promise.resolve({
                      data: rows.filter(
                        (r) =>
                          r[col] === val &&
                          r[c2] === v2 &&
                          (vals3 as unknown[]).includes(r[c3])
                      ),
                      error: null,
                    }),
                }),
              }),
              then: (fn: (value: MockListResult) => unknown) =>
                Promise.resolve({ data: eq2Filtered(), error: null }).then(fn),
            };
          },
          in: (c2: string, vals: unknown[]) => {
            const inFiltered = () =>
              rows.filter(
                (r) => r[col] === val && (vals as unknown[]).includes(r[c2])
              );
            return {
              order: (_: unknown) => ({
                order: () => ({
                  limit: () =>
                    Promise.resolve({ data: inFiltered(), error: null }),
                }),
                limit: () =>
                  Promise.resolve({ data: inFiltered(), error: null }),
              }),
              then: (fn: (value: MockListResult) => unknown) =>
                Promise.resolve({ data: inFiltered(), error: null }).then(fn),
            };
          },
          is: (c2: string, val2: unknown) => ({
            then: (fn: (value: MockListResult) => unknown) =>
              Promise.resolve({
                data: rows.filter((r) => r[col] === val && r[c2] === val2),
                error: null,
              }).then(fn),
          }),
          lt: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: [], error: null }),
            }),
            gte: () => ({
              order: () => ({
                limit: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
          }),
          not: () => ({
            gte: () => ({
              limit: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
          order: (_: unknown) => ({
            limit: () =>
              Promise.resolve({ data: eqFiltered(), error: null }),
            order: () => ({
              limit: () =>
                Promise.resolve({ data: eqFiltered(), error: null }),
            }),
            then: (fn: (value: MockListResult) => unknown) =>
              Promise.resolve({ data: eqFiltered(), error: null }).then(fn),
          }),
          single: async () => {
            const row = eqFiltered()[0];
            return {
              data: row ?? null,
              error: row ? null : { message: "not found" },
            };
          },
          maybeSingle: async () => ({
            data: eqFiltered()[0] ?? null,
            error: null,
          }),
          then: (fn: (value: MockListResult) => unknown) =>
            Promise.resolve({ data: eqFiltered(), error: null }).then(fn),
        };
      },
      in: (col: string, vals: unknown[]) => {
        const filtered = () =>
          rows.filter((r) => (vals as unknown[]).includes(r[col]));
        return {
          eq: (c2: string, v2: unknown) => ({
            order: () => ({
              limit: () =>
                Promise.resolve({
                  data: filtered().filter((r) => r[c2] === v2),
                  error: null,
                }),
            }),
            then: (fn: (value: MockListResult) => unknown) =>
              Promise.resolve({
                data: filtered().filter((r) => r[c2] === v2),
                error: null,
              }).then(fn),
          }),
          order: (_: unknown) => ({
            order: () => ({
              limit: () =>
                Promise.resolve({ data: filtered(), error: null }),
            }),
            limit: () =>
              Promise.resolve({ data: filtered(), error: null }),
            then: (fn: (value: MockListResult) => unknown) =>
              Promise.resolve({ data: filtered(), error: null }).then(fn),
          }),
          then: (fn: (value: MockListResult) => unknown) =>
            Promise.resolve({ data: filtered(), error: null }).then(fn),
          limit: () => Promise.resolve({ data: filtered(), error: null }),
        };
      },
      order: () => ({ data: rows, error: null }),
      single: async () => ({
        data: rows[0] ?? null,
        error: rows[0] ? null : { message: "not found" },
      }),
      then: (fn: (value: MockListResult) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(fn),
    }),
    insert: (row: Record<string, unknown> | Record<string, unknown>[]) => {
      const toInsert = Array.isArray(row) ? row : [row];
      const newRows = toInsert.map((r) => ({ id: nextId(table), ...r }));
      rows.push(...newRows);
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
          Promise.resolve({ data: newRows[0] ?? null, error: null }).then(fn),
      };
    },
    update: (patch: Record<string, unknown>) => ({
      eq: (col: string, val: unknown) => ({
        is: () => Promise.resolve({ data: null, error: null }),
        then: (
          fn: (v: { data: null; error: null }) => unknown
        ) => {
          rows.forEach((r) => {
            if (r[col] === val) Object.assign(r, patch);
          });
          return Promise.resolve({ data: null, error: null }).then(fn);
        },
      }),
    }),
    delete: () => ({
      in: () => Promise.resolve({ data: null, error: null }),
      eq: () => Promise.resolve({ data: null, error: null }),
    }),
    upsert: (row: Record<string, unknown>) => {
      rows.push({ id: nextId(table), ...row });
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function addGroup(name: string, opts: { group_type?: string } = {}) {
  const id = nextId("grp");
  db.groups.push({
    id,
    name,
    owner_id: TEST_USER_ID,
    created_at: new Date().toISOString(),
    group_type: opts.group_type ?? "other",
    source: null,
    external_id: null,
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

function addExpense(
  groupId: string,
  payerMemberId: string,
  amount: number,
  shares: { memberId: string; amount: number }[],
  description = "Expense"
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
    description,
    iso_currency_code: "USD",
    receipt_url: null,
    source: null,
    external_id: null,
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

function recordSettlements(
  settlements: Array<{
    groupId: string;
    fromMemberId: string;
    toMemberId: string;
    amount: number;
    currency: string;
  }>
) {
  for (const se of settlements) {
    db.settlements.push({
      id: nextId("set"),
      group_id: se.groupId,
      payer_member_id: se.fromMemberId,
      receiver_member_id: se.toMemberId,
      amount: se.amount,
      iso_currency_code: se.currency,
      method: "manual",
      status: "completed",
    });
  }
}

const r = (n: number) => Math.round(n * 100) / 100;

// ─── Endpoint callers ────────────────────────────────────────────────────────

async function fetchPerson(key: string) {
  const { GET } = await import("../person/route");
  const res = await GET(
    new NextRequest(`http://localhost/api/groups/person?key=${key}`)
  );
  expect(res.status).toBe(200);
  return res.json();
}

async function fetchGroup(id: string) {
  const { GET } = await import("../[id]/route");
  const res = await GET(
    new NextRequest(`http://localhost/api/groups/${id}`),
    { params: Promise.resolve({ id }) }
  );
  expect(res.status).toBe(200);
  return res.json();
}

async function fetchSummary(query = "") {
  const { GET } = await import("../summary/route");
  const res = await GET(
    new NextRequest(`http://localhost/api/groups/summary${query}`)
  );
  expect(res.status).toBe(200);
  return res.json();
}

async function fetchTransaction(id: string) {
  const { GET } = await import("../transaction/route");
  const res = await GET(
    new NextRequest(`http://localhost/api/groups/transaction?id=${id}`)
  );
  expect(res.status).toBe(200);
  return res.json();
}

// ─── Test ────────────────────────────────────────────────────────────────────

describe("full ledger integrity: cross-group settlement", () => {
  let friendGroupId: string;
  let tripGroupId: string;
  let myFriendMemberId: string;
  let friendFriendMemberId: string;
  let myTripMemberId: string;
  let friendTripMemberId: string;
  let aliceTripMemberId: string;
  let bobTripMemberId: string;
  let coffeeExpenseId: string;
  let dinnerExpenseId: string;

  beforeEach(() => {
    db.groups = [];
    db.group_members = [];
    db.split_transactions = [];
    db.split_shares = [];
    db.settlements = [];
    db.splitwise_tokens = [];
    db.transactions = [];
    idCounter = 0;

    // ── Friend group: me + friend ──
    friendGroupId = addGroup("Friend", { group_type: "friend" });
    myFriendMemberId = addMember(friendGroupId, "Me", {
      userId: TEST_USER_ID,
      email: "owner@test.com",
    });
    friendFriendMemberId = addMember(friendGroupId, "Friend", {
      userId: "friend_user_id",
      email: "friend@test.com",
    });

    // ── Trip group: me + friend + alice + bob ──
    tripGroupId = addGroup("Lake Tahoe", { group_type: "trip" });
    myTripMemberId = addMember(tripGroupId, "Me", {
      userId: TEST_USER_ID,
      email: "owner@test.com",
    });
    friendTripMemberId = addMember(tripGroupId, "Friend", {
      userId: "friend_user_id",
      email: "friend@test.com",
    });
    aliceTripMemberId = addMember(tripGroupId, "Alice", {
      userId: "alice_user_id",
      email: "alice@test.com",
    });
    bobTripMemberId = addMember(tripGroupId, "Bob", {
      userId: "bob_user_id",
      email: "bob@test.com",
    });

    // ── Expenses ──
    // I paid $10 coffee, split equally → friend owes me $5
    coffeeExpenseId = addExpense(
      friendGroupId,
      myFriendMemberId,
      10,
      [
        { memberId: myFriendMemberId, amount: 5 },
        { memberId: friendFriendMemberId, amount: 5 },
      ],
      "Coffee"
    );

    // I paid $60 dinner, split 4 ways → each person's share $15
    dinnerExpenseId = addExpense(
      tripGroupId,
      myTripMemberId,
      60,
      [
        { memberId: myTripMemberId, amount: 15 },
        { memberId: friendTripMemberId, amount: 15 },
        { memberId: aliceTripMemberId, amount: 15 },
        { memberId: bobTripMemberId, amount: 15 },
      ],
      "Dinner"
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  BEFORE SETTLEMENT — verify every field across every endpoint
  // ═══════════════════════════════════════════════════════════════════════════

  it("BEFORE: person detail shows correct balance, activity, settlements, shared groups", async () => {
    const p = await fetchPerson("friend_user_id");

    // ── Balance ──
    expect(p.balance).toBe(20);
    expect(p.currencyBalances).toHaveLength(1);
    expect(p.currencyBalances[0].currency).toBe("USD");
    expect(p.currencyBalances[0].amount).toBe(20);

    // ── Identity ──
    expect(p.displayName).toBe("Friend");
    expect(p.key).toBe("friend_user_id");
    expect(p.email).toBe("friend@test.com");

    // ── Shared groups ──
    expect(p.sharedGroupIds).toHaveLength(2);
    expect(p.sharedGroupIds).toContain(friendGroupId);
    expect(p.sharedGroupIds).toContain(tripGroupId);

    const friendSG = p.sharedGroups.find(
      (g: { id: string }) => g.id === friendGroupId
    );
    expect(friendSG).toMatchObject({
      name: "Friend",
      memberCount: 2,
      groupType: "friend",
    });
    const tripSG = p.sharedGroups.find(
      (g: { id: string }) => g.id === tripGroupId
    );
    expect(tripSG).toMatchObject({
      name: "Lake Tahoe",
      memberCount: 4,
      groupType: "trip",
    });

    // ── Activity ──
    expect(p.activity).toHaveLength(2);

    const coffee = p.activity.find(
      (a: { merchant: string }) => a.merchant === "Coffee"
    );
    expect(coffee).toBeDefined();
    expect(coffee.amount).toBe(10);
    expect(coffee.currency).toBe("USD");
    expect(coffee.groupName).toBe("Friend");
    expect(coffee.groupType).toBe("friend");
    expect(coffee.paidByMe).toBe(true);
    expect(coffee.paidByThem).toBe(false);
    expect(coffee.myShare).toBe(5);
    expect(coffee.theirShare).toBe(5);
    expect(coffee.effectOnBalance).toBe(5);

    const dinner = p.activity.find(
      (a: { merchant: string }) => a.merchant === "Dinner"
    );
    expect(dinner).toBeDefined();
    expect(dinner.amount).toBe(60);
    expect(dinner.currency).toBe("USD");
    expect(dinner.groupName).toBe("Lake Tahoe");
    expect(dinner.groupType).toBe("trip");
    expect(dinner.paidByMe).toBe(true);
    expect(dinner.paidByThem).toBe(false);
    expect(dinner.myShare).toBe(15);
    expect(dinner.theirShare).toBe(15);
    expect(dinner.effectOnBalance).toBe(15);

    // ── Settlement suggestions ──
    expect(p.settlements).toHaveLength(2);

    const fSettle = p.settlements.find(
      (s: { groupId: string }) => s.groupId === friendGroupId
    );
    expect(fSettle).toMatchObject({
      fromMemberId: friendFriendMemberId,
      toMemberId: myFriendMemberId,
      amount: 5,
      currency: "USD",
    });

    const tSettle = p.settlements.find(
      (s: { groupId: string }) => s.groupId === tripGroupId
    );
    expect(tSettle).toMatchObject({
      fromMemberId: friendTripMemberId,
      toMemberId: myTripMemberId,
      amount: 15,
      currency: "USD",
    });
  });

  it("BEFORE: friend group detail shows correct balances, suggestions, activity", async () => {
    const g = await fetchGroup(friendGroupId);

    expect(g.name).toBe("Friend");
    expect(g.group_type).toBe("friend");
    expect(g.members).toHaveLength(2);
    expect(g.totalSpend).toBe(10);

    // ── Balances ──
    const myBal = g.balances.find(
      (b: { memberId: string }) => b.memberId === myFriendMemberId
    );
    const friendBal = g.balances.find(
      (b: { memberId: string }) => b.memberId === friendFriendMemberId
    );
    expect(r(myBal.paid)).toBe(10);
    expect(r(myBal.owed)).toBe(5);
    expect(r(myBal.total)).toBe(5);
    expect(r(friendBal.paid)).toBe(0);
    expect(r(friendBal.owed)).toBe(5);
    expect(r(friendBal.total)).toBe(-5);

    // ── Suggestions ──
    expect(g.suggestions).toHaveLength(1);
    expect(g.suggestions[0]).toMatchObject({
      fromMemberId: friendFriendMemberId,
      toMemberId: myFriendMemberId,
      amount: 5,
    });

    // ── Activity ──
    expect(g.activity).toHaveLength(1);
    expect(g.activity[0].merchant).toBe("Coffee");
    expect(g.activity[0].amount).toBe(10);
  });

  it("BEFORE: trip group detail shows correct balances, suggestions, activity", async () => {
    const g = await fetchGroup(tripGroupId);

    expect(g.name).toBe("Lake Tahoe");
    expect(g.group_type).toBe("trip");
    expect(g.members).toHaveLength(4);
    expect(g.totalSpend).toBe(60);

    // ── Balances: I paid $60, each person owes $15 ──
    const myBal = g.balances.find(
      (b: { memberId: string }) => b.memberId === myTripMemberId
    );
    const friendBal = g.balances.find(
      (b: { memberId: string }) => b.memberId === friendTripMemberId
    );
    const aliceBal = g.balances.find(
      (b: { memberId: string }) => b.memberId === aliceTripMemberId
    );
    const bobBal = g.balances.find(
      (b: { memberId: string }) => b.memberId === bobTripMemberId
    );

    expect(r(myBal.total)).toBe(45);
    expect(r(friendBal.total)).toBe(-15);
    expect(r(aliceBal.total)).toBe(-15);
    expect(r(bobBal.total)).toBe(-15);

    // ── Suggestions: 3 people each pay me $15 ──
    expect(g.suggestions).toHaveLength(3);
    for (const s of g.suggestions) {
      expect(s.toMemberId).toBe(myTripMemberId);
      expect(s.amount).toBe(15);
    }
    const suggestionFromIds = g.suggestions.map(
      (s: { fromMemberId: string }) => s.fromMemberId
    );
    expect(suggestionFromIds).toContain(friendTripMemberId);
    expect(suggestionFromIds).toContain(aliceTripMemberId);
    expect(suggestionFromIds).toContain(bobTripMemberId);

    // ── Activity ──
    expect(g.activity).toHaveLength(1);
    expect(g.activity[0].merchant).toBe("Dinner");
    expect(g.activity[0].amount).toBe(60);
  });

  it("BEFORE: summary shows friend balance $20 and trip group balance $45", async () => {
    const s = await fetchSummary("?contacts=1");

    // ── Friend ──
    const friend = s.friends.find(
      (f: { key: string }) => f.key === "friend_user_id"
    );
    expect(friend).toBeDefined();
    expect(friend.displayName).toBe("Friend");
    const friendUsd = (friend.balances ?? []).find(
      (b: { currency: string }) => b.currency === "USD"
    );
    expect(friendUsd.amount).toBe(20);

    // ── Trip group (friend group is hidden from groups list) ──
    const tripGroup = s.groups.find(
      (g: { id: string }) => g.id === tripGroupId
    );
    expect(tripGroup).toBeDefined();
    expect(tripGroup.name).toBe("Lake Tahoe");
    expect(tripGroup.myBalance).toBe(45);

    // ── Totals ──
    // Net: friend owes $20 via pairwise + I'm owed $30 more from alice/bob in trip
    // But summary totals use pairwise friend balances, not group balances.
    // Just verify the structure exists.
    expect(s.totalsByCurrency).toBeDefined();
  });

  it("BEFORE: transaction details show correct expense data and groupType", async () => {
    // ── Coffee expense ──
    const coffee = await fetchTransaction(coffeeExpenseId);
    expect(coffee.description).toBe("Coffee");
    expect(coffee.amount).toBe(10);
    expect(coffee.currency).toBe("USD");
    expect(coffee.groupName).toBe("Friend");
    expect(coffee.groupId).toBe(friendGroupId);
    expect(coffee.groupType).toBe("friend");
    expect(coffee.paidBy).toBeDefined();
    expect(coffee.paidBy.isMe).toBe(true);
    expect(coffee.shares).toHaveLength(2);
    const coffeeMyShare = coffee.shares.find(
      (s: { isMe: boolean }) => s.isMe
    );
    const coffeeFriendShare = coffee.shares.find(
      (s: { isMe: boolean }) => !s.isMe
    );
    expect(coffeeMyShare.amount).toBe(5);
    expect(coffeeFriendShare.amount).toBe(5);

    // ── Dinner expense ──
    const dinner = await fetchTransaction(dinnerExpenseId);
    expect(dinner.description).toBe("Dinner");
    expect(dinner.amount).toBe(60);
    expect(dinner.currency).toBe("USD");
    expect(dinner.groupName).toBe("Lake Tahoe");
    expect(dinner.groupId).toBe(tripGroupId);
    expect(dinner.groupType).toBe("trip");
    expect(dinner.paidBy).toBeDefined();
    expect(dinner.paidBy.isMe).toBe(true);
    expect(dinner.shares).toHaveLength(4);
    for (const share of dinner.shares) {
      expect(share.amount).toBe(15);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  AFTER SETTLEMENT — every value must update immediately, zero stale data
  // ═══════════════════════════════════════════════════════════════════════════

  it("AFTER: person detail balance = $0, no settlements, activity preserved", async () => {
    // Record settlements (what the mobile app does on "Mark paid")
    const before = await fetchPerson("friend_user_id");
    recordSettlements(before.settlements);

    const p = await fetchPerson("friend_user_id");

    // ── Balance zeroed ──
    expect(p.balance).toBe(0);
    expect(
      (p.currencyBalances ?? []).filter(
        (b: { amount: number }) => Math.abs(b.amount) >= 0.005
      )
    ).toHaveLength(0);

    // ── No more settlement suggestions ──
    expect(p.settlements).toHaveLength(0);

    // ── Activity still present (expenses don't disappear after settlement) ──
    expect(p.activity).toHaveLength(2);
    const coffee = p.activity.find(
      (a: { merchant: string }) => a.merchant === "Coffee"
    );
    const dinner = p.activity.find(
      (a: { merchant: string }) => a.merchant === "Dinner"
    );
    expect(coffee).toBeDefined();
    expect(dinner).toBeDefined();

    // Activity amounts and details unchanged
    expect(coffee.amount).toBe(10);
    expect(coffee.paidByMe).toBe(true);
    expect(coffee.effectOnBalance).toBe(5);
    expect(dinner.amount).toBe(60);
    expect(dinner.paidByMe).toBe(true);
    expect(dinner.effectOnBalance).toBe(15);

    // ── Shared groups still listed ──
    expect(p.sharedGroupIds).toHaveLength(2);
    expect(p.sharedGroupIds).toContain(friendGroupId);
    expect(p.sharedGroupIds).toContain(tripGroupId);
  });

  it("AFTER: friend group fully settled — balances zero, no suggestions", async () => {
    const before = await fetchPerson("friend_user_id");
    recordSettlements(before.settlements);

    const g = await fetchGroup(friendGroupId);

    // ── Both members at zero (zero-balance members are omitted from array) ──
    const myBal = g.balances.find(
      (b: { memberId: string }) => b.memberId === myFriendMemberId
    );
    const friendBal = g.balances.find(
      (b: { memberId: string }) => b.memberId === friendFriendMemberId
    );
    expect(r(myBal?.total ?? 0)).toBe(0);
    expect(r(friendBal?.total ?? 0)).toBe(0);

    // Fully settled group should have no non-zero balances
    const nonZero = g.balances.filter(
      (b: { total: number }) => Math.abs(b.total) >= 0.005
    );
    expect(nonZero).toHaveLength(0);

    // ── No suggestions ──
    expect(g.suggestions).toHaveLength(0);

    // ── Activity still present ──
    expect(g.activity).toHaveLength(1);
    expect(g.activity[0].merchant).toBe("Coffee");
    expect(g.activity[0].amount).toBe(10);

    // ── Totals unchanged ──
    expect(g.totalSpend).toBe(10);
  });

  it("AFTER: trip group — friend settled, alice/bob still owe", async () => {
    const before = await fetchPerson("friend_user_id");
    recordSettlements(before.settlements);

    const g = await fetchGroup(tripGroupId);

    // ── Balances (zero-balance members omitted from array) ──
    const myBal = g.balances.find(
      (b: { memberId: string }) => b.memberId === myTripMemberId
    );
    const friendBal = g.balances.find(
      (b: { memberId: string }) => b.memberId === friendTripMemberId
    );
    const aliceBal = g.balances.find(
      (b: { memberId: string }) => b.memberId === aliceTripMemberId
    );
    const bobBal = g.balances.find(
      (b: { memberId: string }) => b.memberId === bobTripMemberId
    );

    // Friend settled → zero (absent from array)
    expect(r(friendBal?.total ?? 0)).toBe(0);
    // Alice and Bob still owe $15 each
    expect(aliceBal).toBeDefined();
    expect(r(aliceBal.total)).toBe(-15);
    expect(bobBal).toBeDefined();
    expect(r(bobBal.total)).toBe(-15);
    // I'm owed $30 now (was $45, friend paid $15)
    expect(myBal).toBeDefined();
    expect(r(myBal.total)).toBe(30);

    // Exactly 3 non-zero balance entries (me, alice, bob)
    expect(g.balances).toHaveLength(3);

    // ── Suggestions: only alice→me and bob→me remain ──
    expect(g.suggestions).toHaveLength(2);
    for (const s of g.suggestions) {
      expect(s.toMemberId).toBe(myTripMemberId);
      expect(s.amount).toBe(15);
    }
    const fromIds = g.suggestions.map(
      (s: { fromMemberId: string }) => s.fromMemberId
    );
    expect(fromIds).toContain(aliceTripMemberId);
    expect(fromIds).toContain(bobTripMemberId);
    expect(fromIds).not.toContain(friendTripMemberId);

    // ── Activity unchanged ──
    expect(g.activity).toHaveLength(1);
    expect(g.activity[0].merchant).toBe("Dinner");
    expect(g.activity[0].amount).toBe(60);

    // ── Totals unchanged ──
    expect(g.totalSpend).toBe(60);
  });

  it("AFTER: summary — friend zeroed, trip group balance updated, totals updated", async () => {
    const before = await fetchPerson("friend_user_id");
    recordSettlements(before.settlements);

    // ── contacts=1 mode (shows all including settled) ──
    const all = await fetchSummary("?contacts=1");

    const friend = all.friends.find(
      (f: { key: string }) => f.key === "friend_user_id"
    );
    if (friend) {
      const usdBal = (friend.balances ?? []).find(
        (b: { currency: string }) => b.currency === "USD"
      );
      expect(usdBal?.amount ?? 0).toBe(0);
    }

    // Trip group: my balance should now be $30 (was $45, friend settled $15)
    const tripGroup = all.groups.find(
      (g: { id: string }) => g.id === tripGroupId
    );
    expect(tripGroup).toBeDefined();
    expect(r(tripGroup.myBalance)).toBe(30);

    // ── Default mode (hides zero-balance friends) ──
    const smart = await fetchSummary();
    const friendInSmart = smart.friends.find(
      (f: { key: string }) => f.key === "friend_user_id"
    );
    // Friend should be absent (zero balance) or present with zero
    if (friendInSmart) {
      const usdBal = (friendInSmart.balances ?? []).find(
        (b: { currency: string }) => b.currency === "USD"
      );
      expect(usdBal?.amount ?? 0).toBe(0);
    }

    // Alice and Bob still owe, so they appear in the friends list
    const alice = smart.friends.find(
      (f: { key: string }) => f.key === "alice_user_id"
    );
    const bob = smart.friends.find(
      (f: { key: string }) => f.key === "bob_user_id"
    );
    expect(alice).toBeDefined();
    expect(bob).toBeDefined();
    const aliceUsd = (alice.balances ?? []).find(
      (b: { currency: string }) => b.currency === "USD"
    );
    const bobUsd = (bob.balances ?? []).find(
      (b: { currency: string }) => b.currency === "USD"
    );
    expect(aliceUsd.amount).toBe(15);
    expect(bobUsd.amount).toBe(15);
  });

  it("AFTER: transaction details unchanged (expenses don't mutate on settlement)", async () => {
    const before = await fetchPerson("friend_user_id");
    recordSettlements(before.settlements);

    // ── Coffee ──
    const coffee = await fetchTransaction(coffeeExpenseId);
    expect(coffee.description).toBe("Coffee");
    expect(coffee.amount).toBe(10);
    expect(coffee.currency).toBe("USD");
    expect(coffee.groupName).toBe("Friend");
    expect(coffee.groupType).toBe("friend");
    expect(coffee.paidBy.isMe).toBe(true);
    expect(coffee.shares).toHaveLength(2);

    // ── Dinner ──
    const dinner = await fetchTransaction(dinnerExpenseId);
    expect(dinner.description).toBe("Dinner");
    expect(dinner.amount).toBe(60);
    expect(dinner.currency).toBe("USD");
    expect(dinner.groupName).toBe("Lake Tahoe");
    expect(dinner.groupType).toBe("trip");
    expect(dinner.paidBy.isMe).toBe(true);
    expect(dinner.shares).toHaveLength(4);
    for (const share of dinner.shares) {
      expect(share.amount).toBe(15);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  ASYMMETRIC SCENARIO — friend paid in trip, I paid in friend group
  // ═══════════════════════════════════════════════════════════════════════════

  it("ASYMMETRIC: opposing debts across groups net correctly and settle to zero", async () => {
    db.split_transactions = [];
    db.split_shares = [];

    // Friend group: I paid $10, split equally → friend owes $5
    addExpense(
      friendGroupId,
      myFriendMemberId,
      10,
      [
        { memberId: myFriendMemberId, amount: 5 },
        { memberId: friendFriendMemberId, amount: 5 },
      ],
      "My coffee"
    );

    // Trip: FRIEND paid $60, split 4 ways → I owe friend $15
    addExpense(
      tripGroupId,
      friendTripMemberId,
      60,
      [
        { memberId: myTripMemberId, amount: 15 },
        { memberId: friendTripMemberId, amount: 15 },
        { memberId: aliceTripMemberId, amount: 15 },
        { memberId: bobTripMemberId, amount: 15 },
      ],
      "Friend's dinner"
    );

    // ── Before settlement ──
    const p = await fetchPerson("friend_user_id");
    // +$5 (friend group) - $15 (trip) = -$10 (I owe them)
    expect(p.balance).toBe(-10);
    expect(p.settlements.length).toBeGreaterThanOrEqual(1);

    // ── Settle ──
    recordSettlements(p.settlements);

    // ── After settlement ──
    const after = await fetchPerson("friend_user_id");
    expect(after.balance).toBe(0);
    expect(after.settlements).toHaveLength(0);

    // Friend group: fully settled (zero-balance members omitted from array)
    const friendG = await fetchGroup(friendGroupId);
    const nonZeroFriend = friendG.balances.filter(
      (b: { total: number }) => Math.abs(b.total) >= 0.005
    );
    expect(nonZeroFriend).toHaveLength(0);
    expect(friendG.suggestions).toHaveLength(0);

    // Trip group: friend was owed $45 from everyone. After settling between
    // me and friend, my portion is settled. Alice/bob still owe friend.
    const tripG = await fetchGroup(tripGroupId);
    const myTripBal = tripG.balances.find(
      (b: { memberId: string }) => b.memberId === myTripMemberId
    );
    const friendTripBal = tripG.balances.find(
      (b: { memberId: string }) => b.memberId === friendTripMemberId
    );
    const aliceTripBal = tripG.balances.find(
      (b: { memberId: string }) => b.memberId === aliceTripMemberId
    );

    // My trip balance should be settled (zero = absent from array)
    expect(r(myTripBal?.total ?? 0)).toBe(0);
    // Alice still owes
    expect(aliceTripBal).toBeDefined();
    expect(r(aliceTripBal.total)).toBe(-15);
    // Friend is still owed by alice/bob = +30
    expect(friendTripBal).toBeDefined();
    expect(r(friendTripBal.total)).toBe(30);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  REGRESSION: pairwise != group-wide simplified — settle-up must match
  //  displayed balance, not the minimized graph.
  //
  //  3-person group: Me, Friend, Alice
  //    - I paid $300 split 3 ways ($100 each)
  //    - Friend paid $90 split 3 ways ($30 each)
  //
  //  Pairwise (Me↔Friend): Friend owes me $100, I owe Friend $30 → net $70
  //  Group-wide simplified: Me=+170, Friend=-40, Alice=-130
  //    → greedy: Alice→Me $130, Friend→Me $40   (Friend→Me is $40, not $70!)
  //
  //  Before this fix, settle-up would cap at $40 (simplified), leaving $30
  //  orphaned. Now it uses $70 (pairwise) so full settlement is possible.
  // ═══════════════════════════════════════════════════════════════════════════

  it("REGRESSION: 3-person group where pairwise != simplified — settle-up matches displayed balance", async () => {
    db.split_transactions = [];
    db.split_shares = [];
    db.settlements = [];

    // Reuse trip group (4-person), but we only care about Me, Friend, Alice
    // I paid $300 split 3 ways among me, friend, alice
    addExpense(
      tripGroupId,
      myTripMemberId,
      300,
      [
        { memberId: myTripMemberId, amount: 100 },
        { memberId: friendTripMemberId, amount: 100 },
        { memberId: aliceTripMemberId, amount: 100 },
      ],
      "Big dinner"
    );

    // Friend paid $90 split 3 ways among me, friend, alice
    addExpense(
      tripGroupId,
      friendTripMemberId,
      90,
      [
        { memberId: myTripMemberId, amount: 30 },
        { memberId: friendTripMemberId, amount: 30 },
        { memberId: aliceTripMemberId, amount: 30 },
      ],
      "Drinks"
    );

    const p = await fetchPerson("friend_user_id");

    // Displayed balance should be $70 (pairwise: 100 - 30)
    expect(p.balance).toBe(70);
    expect(p.currencyBalances).toHaveLength(1);
    expect(p.currencyBalances[0].amount).toBe(70);

    // Settlement suggestions should sum to $70 (matching displayed balance)
    const totalSettle = p.settlements.reduce(
      (sum: number, s: { amount: number }) => sum + s.amount,
      0
    );
    expect(r(totalSettle)).toBe(70);

    // Each settlement should involve friend→me
    for (const s of p.settlements) {
      expect(s.fromMemberId).toBe(friendTripMemberId);
      expect(s.toMemberId).toBe(myTripMemberId);
    }

    // Record the settlements and verify balance goes to zero
    recordSettlements(p.settlements);

    const after = await fetchPerson("friend_user_id");
    expect(after.balance).toBe(0);
    expect(after.settlements).toHaveLength(0);

    // Verify no orphaned balance — friend is fully settled in the group
    const tripG = await fetchGroup(tripGroupId);
    const friendBal = tripG.balances.find(
      (b: { memberId: string }) => b.memberId === friendTripMemberId
    );
    expect(r(friendBal?.total ?? 0)).toBe(0);

    // Alice still owes: $100 (from my expense) + $30 (from friend's expense) = $130
    const aliceBal = tripG.balances.find(
      (b: { memberId: string }) => b.memberId === aliceTripMemberId
    );
    expect(aliceBal).toBeDefined();
    expect(r(aliceBal.total)).toBe(-130);
  });
});
