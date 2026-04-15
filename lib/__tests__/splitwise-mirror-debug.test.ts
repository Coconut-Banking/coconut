/**
 * Unit tests for lib/splitwise-mirror-debug.ts
 *
 * All Splitwise API calls and DB interactions are mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SplitwiseGroup } from "@/lib/splitwise";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/lib/encryption", () => ({
  decryptToken: (v: string) => `decrypted:${v}`,
}));

// Splitwise state shared across test runs
const sw = {
  groups: {} as Record<number, SplitwiseGroup>,
  expenses: {} as Record<number, ReturnType<typeof makeExpense>[]>,
  nextId: 9000,
  createdGroups: [] as string[],
  addedMembers: [] as { groupId: number; userId: number }[],
};

vi.mock("@/lib/splitwise", () => ({
  getGroup: vi.fn((_t: string, id: number) => {
    if (!sw.groups[id]) throw new Error(`Group ${id} not found`);
    return Promise.resolve(sw.groups[id]);
  }),
  getGroups: vi.fn(() => Promise.resolve(Object.values(sw.groups))),
  getExpenses: vi.fn((_t: string, groupId: number) =>
    Promise.resolve(sw.expenses[groupId] ?? [])
  ),
  createSwExpense: vi.fn((_t: string, p: { group_id: number; description: string; cost: string; currency_code: string; date: string; payment?: boolean; users: { user_id: number; paid_share: string; owed_share: string }[] }) => {
    const id = sw.nextId++;
    const e = makeExpense(id, p);
    if (!sw.expenses[p.group_id]) sw.expenses[p.group_id] = [];
    sw.expenses[p.group_id].push(e);
    return Promise.resolve({ id });
  }),
  createSwGroup: vi.fn((_t: string, name: string, type?: string) => {
    sw.createdGroups.push(name);
    const id = 8000 + sw.createdGroups.length;
    // In real Splitwise, the group creator is automatically a member
    sw.groups[id] = makeGroup(id, name, type ?? "other", [
      { id: 101, email: "alice@test.com", first_name: "Alice", last_name: "Test" },
    ]);
    sw.expenses[id] = [];
    return Promise.resolve({ id });
  }),
  addUserToSwGroup: vi.fn((_t: string, groupId: number, user: { user_id?: number }) => {
    if (user.user_id && sw.groups[groupId]) {
      sw.addedMembers.push({ groupId, userId: user.user_id });
      // Copy member info from any group that has this userId
      for (const g of Object.values(sw.groups)) {
        const m = g.members.find((m) => m.id === user.user_id);
        if (m) { sw.groups[groupId].members.push({ ...m }); break; }
      }
    }
    return Promise.resolve();
  }),
  getCurrentUser: vi.fn(() =>
    Promise.resolve({ id: 101, first_name: "Alice", last_name: "Test", email: "alice@test.com" })
  ),
}));

// ── Test data helpers ─────────────────────────────────────────────────────────

function makeGroup(
  id: number,
  name: string,
  groupType: string,
  members: SplitwiseGroup["members"],
  debts: SplitwiseGroup["simplified_debts"] = []
): SplitwiseGroup {
  return { id, name, group_type: groupType, members, simplified_debts: debts };
}

function makeExpense(
  id: number,
  p: { group_id: number; description: string; cost: string; currency_code: string; date: string; payment?: boolean; users: { user_id: number; paid_share: string; owed_share: string }[] }
) {
  return {
    id,
    group_id: p.group_id,
    description: p.description,
    cost: p.cost,
    currency_code: p.currency_code,
    date: p.date,
    deleted_at: null as null,
    repayments: [] as { from: number; to: number; amount: string }[],
    users: p.users,
    payment: p.payment ?? false,
    details: null as null,
  };
}

const REAL_ID = 555;
const COCONUT_ID = "cg-abc-123";
const REAL_MEMBERS: SplitwiseGroup["members"] = [
  { id: 101, email: "alice@test.com", first_name: "Alice", last_name: "Test" },
  { id: 102, email: "bob@test.com", first_name: "Bob", last_name: "Test" },
];

function setupSw() {
  sw.groups = {};
  sw.expenses = {};
  sw.nextId = 9000;
  sw.createdGroups = [];
  sw.addedMembers = [];

  sw.groups[REAL_ID] = makeGroup(REAL_ID, "Seattle", "other", [...REAL_MEMBERS], [
    { from: 102, to: 101, amount: "10.00", currency_code: "USD" },
  ]);
  sw.expenses[REAL_ID] = [
    makeExpense(201, { group_id: REAL_ID, description: "Dinner", cost: "60.00", currency_code: "USD", date: "2026-01-10", users: [{ user_id: 101, paid_share: "60.00", owed_share: "30.00" }, { user_id: 102, paid_share: "0.00", owed_share: "30.00" }] }),
    makeExpense(202, { group_id: REAL_ID, description: "Groceries", cost: "40.00", currency_code: "USD", date: "2026-01-15", users: [{ user_id: 102, paid_share: "40.00", owed_share: "20.00" }, { user_id: 101, paid_share: "0.00", owed_share: "20.00" }] }),
  ];
}

// Minimal DB stub factory
function makeDb(mirrorMap: Record<string, number> = {}, extraTables: Record<string, unknown[]> = {}) {
  const tokenRow = { clerk_user_id: "user1", access_token: "tok", shadow_mirror_map: mirrorMap, debug_sync_state: {} };
  const tables: Record<string, unknown[]> = { splitwise_tokens: [tokenRow], ...extraTables };

  const from = (table: string) => {
    const rows = tables[table] ?? [];
    const chain = {
      select: () => chain,
      eq: (_c: string, _v: unknown) => chain,
      ilike: (_c: string, v: unknown) => {
        const val = String(v).toLowerCase().replace(/%/g, "");
        const filtered = rows.filter((r) =>
          Object.values(r as Record<string, unknown>).some((fv) =>
            String(fv).toLowerCase().includes(val)
          )
        );
        return {
          ...chain,
          then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
            Promise.resolve(resolve({ data: filtered, error: null })),
        };
      },
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      single: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
        Promise.resolve(resolve({ data: rows, error: null })),
    };
    return chain;
  };

  return {
    from,
    update: (_vals: unknown) => ({ eq: () => Promise.resolve({ error: null }) }),
  } as unknown as ReturnType<typeof import("@/lib/supabase").getSupabase>;
}

// ── Import under test ─────────────────────────────────────────────────────────

import {
  resolveGroupByName,
  buildRealToMirrorMemberMap,
  cloneMirrorGroup,
  verifyMirrorParity,
  type ResolvedGroup,
} from "../splitwise-mirror-debug";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("buildRealToMirrorMemberMap", () => {
  it("maps members by email", () => {
    const real: SplitwiseGroup["members"] = [
      { id: 1, email: "alice@test.com", first_name: "A", last_name: "B" },
      { id: 2, email: "bob@test.com", first_name: "C", last_name: "D" },
    ];
    const mirror: SplitwiseGroup["members"] = [
      { id: 10, email: "alice@test.com", first_name: "A", last_name: "B" },
      { id: 20, email: "bob@test.com", first_name: "C", last_name: "D" },
    ];
    const map = buildRealToMirrorMemberMap(real, mirror);
    expect(map.get(1)).toBe(10);
    expect(map.get(2)).toBe(20);
  });

  it("is case-insensitive", () => {
    const real: SplitwiseGroup["members"] = [{ id: 1, email: "Alice@Test.COM", first_name: "A", last_name: "B" }];
    const mirror: SplitwiseGroup["members"] = [{ id: 10, email: "alice@test.com", first_name: "A", last_name: "B" }];
    expect(buildRealToMirrorMemberMap(real, mirror).get(1)).toBe(10);
  });

  it("skips members without email", () => {
    const real: SplitwiseGroup["members"] = [{ id: 1, email: "", first_name: "A", last_name: "B" }];
    const mirror: SplitwiseGroup["members"] = [{ id: 10, email: "alice@test.com", first_name: "A", last_name: "B" }];
    expect(buildRealToMirrorMemberMap(real, mirror).size).toBe(0);
  });

  it("maps both real members to the same mirror if they share an email", () => {
    // Duplicate emails are pathological but the map just maps both to the same mirror ID
    const real: SplitwiseGroup["members"] = [
      { id: 1, email: "alice@test.com", first_name: "A", last_name: "B" },
      { id: 2, email: "alice@test.com", first_name: "A", last_name: "B" }, // dup
    ];
    const mirror: SplitwiseGroup["members"] = [{ id: 10, email: "alice@test.com", first_name: "A", last_name: "B" }];
    const map = buildRealToMirrorMemberMap(real, mirror);
    expect(map.get(1)).toBe(10);
    expect(map.get(2)).toBe(10);
  });
});

describe("resolveGroupByName", () => {
  beforeEach(() => { setupSw(); vi.clearAllMocks(); setupSw(); });

  it("finds a Splitwise-linked coconut group", async () => {
    const db = makeDb({}, {
      groups: [{ id: COCONUT_ID, name: "Seattle", external_id: String(REAL_ID), source: "splitwise" }],
    });
    const result = await resolveGroupByName(db, "tok", "Seattle");
    expect(result.coconutGroupId).toBe(COCONUT_ID);
    expect(result.realSwGroupId).toBe(REAL_ID);
    expect(result.swGroup.members).toHaveLength(2);
  });

  it("throws if no Splitwise-linked group matches", async () => {
    const db = makeDb({}, {
      groups: [{ id: "other", name: "Seattle", external_id: null, source: "manual" }],
    });
    await expect(resolveGroupByName(db, "tok", "Seattle")).rejects.toThrow(
      /No Splitwise-linked coconut group/
    );
  });
});

describe("cloneMirrorGroup", () => {
  beforeEach(() => { setupSw(); vi.clearAllMocks(); setupSw(); });

  const resolved = (): ResolvedGroup => ({
    coconutGroupId: COCONUT_ID,
    coconutGroupName: "Seattle",
    realSwGroupId: REAL_ID,
    swGroup: sw.groups[REAL_ID],
  });

  it("creates a mirror group and copies all expenses", async () => {
    const db = makeDb();
    const result = await cloneMirrorGroup(db, "tok", "user1", resolved(), 40);

    expect(result.alreadyExisted).toBe(false);
    expect(result.copied).toBe(2);
    expect(result.skipped).toBe(0);
    expect(sw.createdGroups).toContain("Mirror Seattle");
    // Bob (102) should have been added; Alice (101) is self (getCurrentUser returns 101)
    expect(sw.addedMembers.some((m) => m.userId === 102)).toBe(true);
    expect(sw.addedMembers.some((m) => m.userId === 101)).toBe(false);
  });

  it("finds existing mirror by name and does NOT create a new group", async () => {
    const MIRROR_ID = 8500;
    sw.groups[MIRROR_ID] = makeGroup(MIRROR_ID, "Mirror Seattle", "other", [...REAL_MEMBERS]);
    sw.expenses[MIRROR_ID] = [];

    const db = makeDb();
    const result = await cloneMirrorGroup(db, "tok", "user1", resolved(), 40);

    expect(result.mirrorSwGroupId).toBe(MIRROR_ID);
    expect(result.alreadyExisted).toBe(true);
    expect(sw.createdGroups).toHaveLength(0);
  });

  it("uses existing mirror from mirror map without name lookup", async () => {
    const MIRROR_ID = 8600;
    sw.groups[MIRROR_ID] = makeGroup(MIRROR_ID, "Mirror Seattle", "other", [...REAL_MEMBERS]);
    sw.expenses[MIRROR_ID] = [];

    const db = makeDb({ [COCONUT_ID]: MIRROR_ID });
    const result = await cloneMirrorGroup(db, "tok", "user1", resolved(), 40);

    expect(result.mirrorSwGroupId).toBe(MIRROR_ID);
    expect(result.alreadyExisted).toBe(true);
    expect(sw.createdGroups).toHaveLength(0);
  });

  it("skips expenses where a member has no mirror mapping", async () => {
    // Add a third member to real group that won't have a mirror counterpart
    sw.groups[REAL_ID].members.push({ id: 999, email: "", first_name: "Ghost", last_name: "User" });
    sw.expenses[REAL_ID].push(makeExpense(203, {
      group_id: REAL_ID, description: "Pizza", cost: "30.00", currency_code: "USD", date: "2026-01-20",
      users: [{ user_id: 101, paid_share: "30.00", owed_share: "15.00" }, { user_id: 999, paid_share: "0.00", owed_share: "15.00" }],
    }));

    const db = makeDb();
    const result = await cloneMirrorGroup(db, "tok", "user1", resolved(), 40);

    // 2 original expenses should copy; 1 with ghost user should be skipped
    expect(result.copied).toBe(2);
    expect(result.skipped).toBe(1);
  });
});

describe("verifyMirrorParity", () => {
  beforeEach(() => { setupSw(); vi.clearAllMocks(); setupSw(); });

  const resolved = (): ResolvedGroup => ({
    coconutGroupId: COCONUT_ID,
    coconutGroupName: "Seattle",
    realSwGroupId: REAL_ID,
    swGroup: sw.groups[REAL_ID],
  });

  it("returns parity=true when simplified_debts match", async () => {
    const MIRROR_ID = 8800;
    sw.groups[MIRROR_ID] = makeGroup(MIRROR_ID, "Mirror Seattle", "other",
      [{ id: 201, email: "alice@test.com", first_name: "Alice", last_name: "T" },
       { id: 202, email: "bob@test.com", first_name: "Bob", last_name: "T" }],
      [{ from: 202, to: 201, amount: "10.00", currency_code: "USD" }]
    );

    const db = makeDb({ [COCONUT_ID]: MIRROR_ID });
    const result = await verifyMirrorParity(db, "tok", "user1", resolved());

    expect(result.parity).toBe(true);
    expect(result.discrepancies).toHaveLength(0);
  });

  it("returns parity=false with discrepancies when amounts differ", async () => {
    const MIRROR_ID = 8900;
    sw.groups[MIRROR_ID] = makeGroup(MIRROR_ID, "Mirror Seattle", "other",
      [{ id: 201, email: "alice@test.com", first_name: "Alice", last_name: "T" },
       { id: 202, email: "bob@test.com", first_name: "Bob", last_name: "T" }],
      [{ from: 202, to: 201, amount: "99.00", currency_code: "USD" }] // should be 10.00
    );

    const db = makeDb({ [COCONUT_ID]: MIRROR_ID });
    const result = await verifyMirrorParity(db, "tok", "user1", resolved());

    expect(result.parity).toBe(false);
    expect(result.discrepancies.length).toBeGreaterThan(0);
    expect(result.discrepancies[0]).toMatch(/real=|mirror=/);
  });

  it("considers balances within $0.02 as matching (floating-point tolerance)", async () => {
    const MIRROR_ID = 8950;
    // Real: 10.00, Mirror: 10.01 — within tolerance
    sw.groups[MIRROR_ID] = makeGroup(MIRROR_ID, "Mirror Seattle", "other",
      [{ id: 201, email: "alice@test.com", first_name: "Alice", last_name: "T" },
       { id: 202, email: "bob@test.com", first_name: "Bob", last_name: "T" }],
      [{ from: 202, to: 201, amount: "10.01", currency_code: "USD" }]
    );

    const db = makeDb({ [COCONUT_ID]: MIRROR_ID });
    const result = await verifyMirrorParity(db, "tok", "user1", resolved());
    expect(result.parity).toBe(true);
  });

  it("throws if mirror group not in map or SW", async () => {
    const db = makeDb({}); // empty mirror map
    await expect(verifyMirrorParity(db, "tok", "user1", resolved())).rejects.toThrow(/clone first/i);
  });
});
