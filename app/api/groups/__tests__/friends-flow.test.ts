/**
 * Integration test: add friend → groups summary shows friend
 *
 * Tests the full flow:
 * 1. POST /api/groups → creates a group
 * 2. POST /api/groups/:id/members → adds a friend member
 * 3. GET /api/groups/summary → friend appears in friends list
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const TEST_USER_ID = "test_user_friends_flow";
const FRIEND_NAME = "Harsh Shah";
const FRIEND_EMAIL = "harsh@gmail.com";

// ─── Auth mock ────────────────────────────────────────────────────────────────
vi.mock("@/lib/auth", () => ({
  getUserId: vi.fn().mockResolvedValue(TEST_USER_ID),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: TEST_USER_ID, getToken: async () => null }),
  currentUser: vi.fn().mockResolvedValue({
    primaryEmailAddress: { emailAddress: "owner@test.com" },
    emailAddresses: [{ emailAddress: "owner@test.com" }],
  }),
}));

// ─── Supabase in-memory mock ──────────────────────────────────────────────────
const db = {
  groups: [] as Record<string, unknown>[],
  group_members: [] as Record<string, unknown>[],
  split_transactions: [] as Record<string, unknown>[],
  split_shares: [] as Record<string, unknown>[],
  settlements: [] as Record<string, unknown>[],
};

function makeClient() {
  return {
    from: (table: string) => makeTable(table),
  };
}

/** Supabase-style list query result used by mock `.then` chains */
type MockListResult = { data: Record<string, unknown>[]; error: null };
/** Single-row or null data */
type MockMaybeRowResult = { data: Record<string, unknown> | null; error: null };
type MockNullResult = { data: null; error: null };

function makeTable(table: string) {
  const rows = db[table as keyof typeof db] as Record<string, unknown>[];

  return {
    select: (_cols?: string) => ({
      eq: (col: string, val: unknown) => ({
        eq: (c2: string, v2: unknown) => ({
          maybeSingle: async () => ({ data: rows.find(r => r[col] === val && r[c2] === v2) ?? null, error: null }),
          single: async () => ({ data: rows.find(r => r[col] === val && r[c2] === v2) ?? null, error: null }),
          in: (c3: string, vals3: unknown[]) => ({
            order: () => ({ limit: () => Promise.resolve({ data: rows.filter(r => r[col] === val && r[c2] === v2 && (vals3 as unknown[]).includes(r[c3])), error: null, count: null }) }),
          }),
        }),
        in: (c2: string, vals: unknown[]) => ({
          order: (_: unknown, opts?: { ascending?: boolean }) => ({
            order: () => ({ limit: () => Promise.resolve({ data: rows.filter(r => r[col] === val && (vals as unknown[]).includes(r[c2])), error: null }) }),
            limit: () => Promise.resolve({ data: rows.filter(r => r[col] === val && (vals as unknown[]).includes(r[c2])), error: null }),
            resolve: () => Promise.resolve({ data: rows.filter(r => r[col] === val && (vals as unknown[]).includes(r[c2])), error: null }),
          }),
          resolve: () => Promise.resolve({ data: rows.filter(r => r[col] === val && (vals as unknown[]).includes(r[c2])), error: null }),
          then: (fn: (value: MockListResult) => unknown) =>
            Promise.resolve({ data: rows.filter(r => r[col] === val && (vals as unknown[]).includes(r[c2])), error: null }).then(fn),
        }),
        is: (c2: string, val2: unknown) => ({
          then: (fn: (value: MockListResult) => unknown) =>
            Promise.resolve({ data: rows.filter(r => r[col] === val && r[c2] === val2), error: null }).then(fn),
        }),
        lt: (c2: string, val2: unknown) => ({
          order: () => ({ limit: () => Promise.resolve({ data: rows.filter(r => r[col] === val && (r[c2] as number) < (val2 as number)), error: null }) }),
          gte: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }),
        }),
        not: (c2: string, op: string, val2: unknown) => ({
          gte: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }),
        }),
        order: (_: unknown, opts?: { ascending?: boolean }) => ({
          limit: () => Promise.resolve({ data: rows.filter(r => r[col] === val), error: null }),
          order: () => ({ limit: () => Promise.resolve({ data: rows.filter(r => r[col] === val), error: null }) }),
        }),
        single: async () => {
          const row = rows.find(r => r[col] === val);
          return { data: row ?? null, error: row ? null : { message: "not found" } };
        },
        maybeSingle: async () => ({ data: rows.find(r => r[col] === val) ?? null, error: null }),
        then: (fn: (value: MockListResult) => unknown) =>
          Promise.resolve({ data: rows.filter(r => r[col] === val), error: null }).then(fn),
      }),
      in: (col: string, vals: unknown[]) => {
        const filtered = () => rows.filter(r => (vals as unknown[]).includes(r[col]));
        return {
          eq: (c2: string, v2: unknown) => ({
            order: () => ({ limit: () => Promise.resolve({ data: filtered().filter(r => r[c2] === v2), error: null }) }),
            then: (fn: (value: MockListResult) => unknown) =>
              Promise.resolve({ data: filtered().filter(r => r[c2] === v2), error: null }).then(fn),
          }),
          order: (_: unknown, opts?: { ascending?: boolean }) => ({
            order: () => ({ limit: () => Promise.resolve({ data: filtered(), error: null }) }),
            limit: () => Promise.resolve({ data: filtered(), error: null }),
            then: (fn: (value: MockListResult) => unknown) =>
              Promise.resolve({ data: filtered(), error: null }).then(fn),
          }),
          then: (fn: (value: MockListResult) => unknown) =>
            Promise.resolve({ data: filtered(), error: null }).then(fn),
          limit: () => Promise.resolve({ data: filtered(), error: null }),
        };
      },
      order: () => ({ data: rows, error: null }),
      single: async () => ({ data: rows[0] ?? null, error: rows[0] ? null : { message: "not found" } }),
      lt: (col: string, val: unknown) => ({
        order: () => ({ limit: () => Promise.resolve({ data: rows.filter(r => (r[col] as number) < (val as number)), error: null }) }),
        gte: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }),
      }),
      then: (fn: (value: MockListResult) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(fn),
    }),
    insert: (row: Record<string, unknown> | Record<string, unknown>[]) => {
      const toInsert = Array.isArray(row) ? row : [row];
      const newRows = toInsert.map(r => ({ id: `${table}_${Math.random().toString(36).slice(2)}`, ...r }));
      rows.push(...newRows);
      return {
        select: (_?: string) => ({
          single: async () => ({ data: newRows[0], error: null }),
          then: (fn: (value: MockListResult) => unknown) =>
            Promise.resolve({ data: newRows, error: null }).then(fn),
        }),
        then: (fn: (value: MockMaybeRowResult) => unknown) =>
          Promise.resolve({ data: newRows[0] ?? null, error: null }).then(fn),
      };
    },
    update: (patch: Record<string, unknown>) => ({
      eq: (col: string, val: unknown) => ({
        is: () => Promise.resolve({ data: null, error: null }),
        then: (fn: (value: MockNullResult) => unknown) => {
          rows.forEach(r => { if (r[col] === val) Object.assign(r, patch); });
          return Promise.resolve({ data: null, error: null }).then(fn);
        },
      }),
    }),
    delete: () => ({
      in: (col: string, vals: unknown[]) => Promise.resolve({ data: null, error: null }),
      eq: (col: string, val: unknown) => Promise.resolve({ data: null, error: null }),
    }),
    upsert: (row: Record<string, unknown>, opts?: unknown) => {
      rows.push({ id: `${table}_${Math.random().toString(36).slice(2)}`, ...row });
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("add friend → summary flow", () => {
  beforeEach(() => {
    // Reset in-memory DB
    db.groups = [];
    db.group_members = [];
    db.split_transactions = [];
    db.split_shares = [];
    db.settlements = [];
  });

  it("creates a group and adds a member", async () => {
    const { POST: createGroup } = await import("../route");

    const req = new NextRequest("http://localhost/api/groups", {
      method: "POST",
      body: JSON.stringify({ name: FRIEND_NAME, ownerDisplayName: "You" }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await createGroup(req);
    expect(res.status).toBe(200);
    const group = await res.json();
    expect(group.id).toBeDefined();
    expect(group.name).toBe(FRIEND_NAME);

    expect(db.groups).toHaveLength(1);
    expect(db.groups[0]).toMatchObject({ owner_id: TEST_USER_ID, name: FRIEND_NAME });
    // Owner should be auto-added as a member
    expect(db.group_members.some(m => m.user_id === TEST_USER_ID)).toBe(true);
  });

  it("adds a friend member to a group", async () => {
    const { POST: createGroup } = await import("../route");
    const createReq = new NextRequest("http://localhost/api/groups", {
      method: "POST",
      body: JSON.stringify({ name: FRIEND_NAME, ownerDisplayName: "You" }),
      headers: { "Content-Type": "application/json" },
    });
    const createRes = await createGroup(createReq);
    const group = await createRes.json();

    const { POST: addMember } = await import("../[id]/members/route");
    const memberReq = new NextRequest(`http://localhost/api/groups/${group.id}/members`, {
      method: "POST",
      body: JSON.stringify({ displayName: FRIEND_NAME, email: FRIEND_EMAIL }),
      headers: { "Content-Type": "application/json" },
    });

    const memberRes = await addMember(memberReq, { params: Promise.resolve({ id: group.id }) });
    expect(memberRes.status).toBe(200);
    const member = await memberRes.json();
    expect(member.display_name).toBe(FRIEND_NAME);
    expect(member.email).toBe(FRIEND_EMAIL);
    expect(member.user_id).toBeNull();

    const friendMembers = db.group_members.filter(m => m.user_id === null);
    expect(friendMembers).toHaveLength(1);
    expect(friendMembers[0]).toMatchObject({ display_name: FRIEND_NAME, email: FRIEND_EMAIL });
  });

  it("summary returns the friend after adding", async () => {
    // Step 1: Create group
    const { POST: createGroup } = await import("../route");
    const createReq = new NextRequest("http://localhost/api/groups", {
      method: "POST",
      body: JSON.stringify({ name: FRIEND_NAME, ownerDisplayName: "You" }),
      headers: { "Content-Type": "application/json" },
    });
    const createRes = await createGroup(createReq);
    const group = await createRes.json();
    expect(group.id).toBeDefined();

    // Step 2: Add friend member
    const { POST: addMember } = await import("../[id]/members/route");
    const memberReq = new NextRequest(`http://localhost/api/groups/${group.id}/members`, {
      method: "POST",
      body: JSON.stringify({ displayName: FRIEND_NAME, email: FRIEND_EMAIL }),
      headers: { "Content-Type": "application/json" },
    });
    const memberRes = await addMember(memberReq, { params: Promise.resolve({ id: group.id }) });
    expect(memberRes.status).toBe(200);

    // Step 3: Get summary — friend should appear
    const { GET: getSummary } = await import("../summary/route");
    const summaryRes = await getSummary();
    expect(summaryRes.status).toBe(200);
    const summary = await summaryRes.json();

    expect(summary.groups).toHaveLength(1);
    expect(summary.groups[0].name).toBe(FRIEND_NAME);

    // Friend should appear in friends list (from our "include all members" fix)
    const friend = summary.friends.find((f: { displayName: string }) => f.displayName === FRIEND_NAME);
    expect(friend).toBeDefined();
    expect(friend?.balance).toBe(0);
  });

  it("summary shows 0 groups and friends when user has none", async () => {
    const { GET: getSummary } = await import("../summary/route");
    const res = await getSummary();
    const summary = await res.json();

    expect(summary.groups).toHaveLength(0);
    expect(summary.friends).toHaveLength(0);
    expect(summary.netBalance).toBe(0);
  });
});
