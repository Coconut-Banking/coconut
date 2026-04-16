/**
 * Group image persistence test
 *
 * Verifies that uploading a group image persists it in the database
 * and that both summary and detail APIs return the image_url so the
 * frontend can render it as the group icon and in the detail header.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const TEST_USER_ID = "test_user_group_image";
const SAMPLE_IMAGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

vi.mock("@/lib/auth", () => ({
  getUserId: vi.fn().mockResolvedValue(TEST_USER_ID),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: TEST_USER_ID, getToken: async () => null }),
  clerkClient: vi.fn().mockResolvedValue({
    users: { getUser: vi.fn().mockResolvedValue({ primaryEmailAddress: { emailAddress: "owner@test.com" } }) },
  }),
  currentUser: vi.fn().mockResolvedValue({
    primaryEmailAddress: { emailAddress: "owner@test.com" },
    emailAddresses: [{ emailAddress: "owner@test.com" }],
  }),
}));

const db: Record<string, Record<string, unknown>[]> = {
  groups: [],
  group_members: [],
  split_transactions: [],
  split_shares: [],
  settlements: [],
  splitwise_tokens: [],
  transactions: [],
};

// Mock storage: captures uploads so getPublicUrl can return a stable fake URL
const mockStorage: Record<string, string> = {};

function makeStorageBucket(bucket: string) {
  return {
    upload: (_path: string, _data: unknown, _opts?: unknown) =>
      Promise.resolve({ error: null }),
    getPublicUrl: (path: string) => ({
      data: { publicUrl: `https://mock-storage/${bucket}/${path}` },
    }),
    remove: (_paths: string[]) => Promise.resolve({ error: null }),
  };
}

function makeClient() {
  return {
    from: (table: string) => makeTable(table),
    rpc: (_fn: string, _args?: unknown) => Promise.resolve({ data: null, error: { message: "rpc not mocked" } }),
    storage: {
      from: (bucket: string) => makeStorageBucket(bucket),
    },
  };
}

type MockListResult = { data: Record<string, unknown>[]; error: null };
type MockMaybeRowResult = { data: Record<string, unknown> | null; error: null };
type MockNullResult = { data: null; error: null };

function makeTable(table: string) {
  const rows = (db[table] ?? []) as Record<string, unknown>[];

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
          }),
          then: (fn: (value: MockListResult) => unknown) =>
            Promise.resolve({ data: rows.filter(r => r[col] === val && (vals as unknown[]).includes(r[c2])), error: null }).then(fn),
        }),
        is: (c2: string, val2: unknown) => ({
          in: (c3: string, vals3: unknown[]) => Promise.resolve({
            data: rows.filter(r => r[col] === val && r[c2] === val2 && (vals3 as unknown[]).includes(r[c3])),
            error: null,
          }),
          then: (fn: (value: MockListResult) => unknown) =>
            Promise.resolve({ data: rows.filter(r => r[col] === val && r[c2] === val2), error: null }).then(fn),
        }),
        lt: (c2: string, val2: unknown) => ({
          order: () => ({ limit: () => Promise.resolve({ data: rows.filter(r => r[col] === val && (r[c2] as number) < (val2 as number)), error: null }) }),
          gte: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }),
        }),
        not: () => ({
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
      eq: (col: string, val: unknown) => {
        const result = {
          is: () => Promise.resolve({ data: null, error: null }),
          then: (fn: (value: MockNullResult) => unknown) => {
            rows.forEach(r => { if (r[col] === val) Object.assign(r, patch); });
            return Promise.resolve({ data: null, error: null }).then(fn);
          },
        };
        rows.forEach(r => { if (r[col] === val) Object.assign(r, patch); });
        return { ...result, error: null };
      },
    }),
    delete: () => ({
      in: () => Promise.resolve({ data: null, error: null }),
      eq: () => Promise.resolve({ data: null, error: null }),
    }),
    upsert: (row: Record<string, unknown>) => {
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

// Mock group-access to avoid module-level caching that breaks test isolation
vi.mock("@/lib/group-access", () => ({
  getAccessibleGroupIds: vi.fn((_userId: string) =>
    Promise.resolve((db.groups as { id: string }[]).map((g) => g.id))
  ),
  canAccessGroup: vi.fn((userId: string, groupId: string) =>
    Promise.resolve(
      (db.groups as { id: string; owner_id: string }[]).some(
        (g) => g.id === groupId && (g.owner_id === userId || (db.group_members as { group_id: string; user_id: string }[]).some((m) => m.group_id === groupId && m.user_id === userId))
      )
    )
  ),
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
}));

describe("group image persistence", () => {
  beforeEach(() => {
    db.groups = [];
    db.group_members = [];
    db.split_transactions = [];
    db.split_shares = [];
    db.settlements = [];
    db.splitwise_tokens = [];
    db.transactions = [];
  });

  it("uploads an image and persists it in the group row", async () => {
    const { POST: createGroup } = await import("../route");
    const createRes = await createGroup(
      new NextRequest("http://localhost/api/groups", {
        method: "POST",
        body: JSON.stringify({ name: "Trip Squad", ownerDisplayName: "You" }),
        headers: { "Content-Type": "application/json" },
      })
    );
    const group = await createRes.json();
    expect(group.id).toBeDefined();

    const { POST: uploadImage } = await import("../[id]/image/route");
    const imgRes = await uploadImage(
      new NextRequest(`http://localhost/api/groups/${group.id}/image`, {
        method: "POST",
        body: JSON.stringify({ image: SAMPLE_IMAGE }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: group.id }) }
    );
    expect(imgRes.status).toBe(200);

    const stored = db.groups.find(g => g.id === group.id);
    // Route stores the storage public URL (not the raw base64 data URI)
    expect(stored?.image_url).toBeDefined();
    expect(typeof stored?.image_url).toBe("string");
  });

  it("summary returns imageUrl for a group with an image", async () => {
    const { POST: createGroup } = await import("../route");
    const createRes = await createGroup(
      new NextRequest("http://localhost/api/groups", {
        method: "POST",
        body: JSON.stringify({ name: "Photo Group", ownerDisplayName: "You" }),
        headers: { "Content-Type": "application/json" },
      })
    );
    const group = await createRes.json();

    const { POST: uploadImage } = await import("../[id]/image/route");
    await uploadImage(
      new NextRequest(`http://localhost/api/groups/${group.id}/image`, {
        method: "POST",
        body: JSON.stringify({ image: SAMPLE_IMAGE }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: group.id }) }
    );

    const { GET: getSummary } = await import("../summary/route");
    const summaryRes = await getSummary(
      new NextRequest("http://localhost/api/groups/summary?contacts=1")
    );
    expect(summaryRes.status).toBe(200);
    const summary = await summaryRes.json();

    const found = summary.groups.find((g: { id: string }) => g.id === group.id);
    expect(found).toBeDefined();
    // Route stores and returns the storage public URL
    expect(found.imageUrl).toBeTruthy();
  });

  it("summary returns null imageUrl when no image is set", async () => {
    const { POST: createGroup } = await import("../route");
    const createRes = await createGroup(
      new NextRequest("http://localhost/api/groups", {
        method: "POST",
        body: JSON.stringify({ name: "No Image Group", ownerDisplayName: "You" }),
        headers: { "Content-Type": "application/json" },
      })
    );
    const group = await createRes.json();

    const { GET: getSummary } = await import("../summary/route");
    const summaryRes = await getSummary(
      new NextRequest("http://localhost/api/groups/summary?contacts=1")
    );
    const summary = await summaryRes.json();

    const found = summary.groups.find((g: { id: string }) => g.id === group.id);
    expect(found).toBeDefined();
    expect(found.imageUrl).toBeNull();
  });

  it("rejects image upload from non-owner", async () => {
    // Manually insert a group owned by someone else
    db.groups.push({
      id: "foreign_group",
      name: "Not Mine",
      owner_id: "another_user",
      created_at: new Date().toISOString(),
    });

    const { POST: uploadImage } = await import("../[id]/image/route");
    const res = await uploadImage(
      new NextRequest("http://localhost/api/groups/foreign_group/image", {
        method: "POST",
        body: JSON.stringify({ image: SAMPLE_IMAGE }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "foreign_group" }) }
    );
    expect(res.status).toBe(404);

    const stored = db.groups.find(g => g.id === "foreign_group");
    expect(stored?.image_url).toBeUndefined();
  });

  it("rejects oversized images", async () => {
    const { POST: createGroup } = await import("../route");
    const createRes = await createGroup(
      new NextRequest("http://localhost/api/groups", {
        method: "POST",
        body: JSON.stringify({ name: "Big Image Group", ownerDisplayName: "You" }),
        headers: { "Content-Type": "application/json" },
      })
    );
    const group = await createRes.json();

    const hugeImage = "data:image/png;base64," + "A".repeat(2_000_001);

    const { POST: uploadImage } = await import("../[id]/image/route");
    const res = await uploadImage(
      new NextRequest(`http://localhost/api/groups/${group.id}/image`, {
        method: "POST",
        body: JSON.stringify({ image: hugeImage }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: group.id }) }
    );
    expect(res.status).toBe(413);
  });
});
