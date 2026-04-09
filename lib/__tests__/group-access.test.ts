import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @clerk/nextjs/server before importing getAccessibleGroupIds
vi.mock("@clerk/nextjs/server", () => ({
  currentUser: vi.fn().mockResolvedValue(null),
}));

vi.mock("../supabase", () => ({
  getSupabase: vi.fn(),
}));

import { getAccessibleGroupIds } from "../group-access";
import { getSupabase } from "../supabase";

const mockGetSupabase = vi.mocked(getSupabase);

/**
 * Build a minimal Supabase-like client whose .from() always resolves
 * to the provided data and has no rpc method.
 * Each .from(table) call returns based on a map of table -> data.
 */
function makeDbWithoutRpc(tableData: Record<string, unknown[]>) {
  const makeChain = (rows: unknown[]) => {
    const q: Record<string, unknown> = {};
    q.select = vi.fn(() => q);
    q.eq = vi.fn(() => q);
    q.is = vi.fn(() => Promise.resolve({ data: rows, error: null }));
    // Make the chain itself awaitable (the fallback queries do `await db.from(...).select(...).eq(...)`)
    q.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(resolve);
    return q;
  };

  return {
    from: vi.fn((table: string) => makeChain(tableData[table] ?? [])),
    // No rpc property — this is the bug trigger
  };
}

describe("getAccessibleGroupIds (BUG-RESILIENCE-1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does NOT throw when db.rpc is missing — falls back to two-query path", async () => {
    const db = makeDbWithoutRpc({
      group_members: [],
      groups: [{ id: "group-owned" }],
    });

    mockGetSupabase.mockReturnValue(db as never);

    // Before the fix: throws TypeError: db.rpc is not a function
    // After the fix: catches, logs a warning, and proceeds with fallback
    await expect(getAccessibleGroupIds("user-test")).resolves.not.toThrow();
  });

  it("returns owned groups via fallback when db.rpc is missing", async () => {
    const db = makeDbWithoutRpc({
      group_members: [],
      groups: [{ id: "group-owned" }],
    });

    mockGetSupabase.mockReturnValue(db as never);

    const ids = await getAccessibleGroupIds("user-test-2");

    expect(ids).toContain("group-owned");
  });

  it("uses RPC result directly when db.rpc succeeds", async () => {
    const makeChain = () => {
      const q: Record<string, unknown> = {};
      q.select = vi.fn(() => q);
      q.eq = vi.fn(() => q);
      q.is = vi.fn(() => Promise.resolve({ data: [], error: null }));
      q.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve);
      return q;
    };

    const db = {
      from: vi.fn(() => makeChain()),
      rpc: vi.fn().mockResolvedValue({
        data: ["group-rpc-1", "group-rpc-2"],
        error: null,
      }),
    };

    mockGetSupabase.mockReturnValue(db as never);

    const ids = await getAccessibleGroupIds("user-rpc");

    expect(db.rpc).toHaveBeenCalledWith("get_accessible_group_ids", {
      p_user_id: "user-rpc",
    });
    expect(ids).toEqual(["group-rpc-1", "group-rpc-2"]);
  });

  it("uses fallback two-query path when db.rpc returns an error object (not a throw)", async () => {
    const makeChain = (rows: unknown[]) => {
      const q: Record<string, unknown> = {};
      q.select = vi.fn(() => q);
      q.eq = vi.fn(() => q);
      q.is = vi.fn(() => Promise.resolve({ data: [], error: null }));
      q.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(resolve);
      return q;
    };

    const db = {
      from: vi.fn((table: string) => {
        if (table === "groups") return makeChain([{ id: "group-err-fallback" }]);
        return makeChain([]);
      }),
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "function not found" },
      }),
    };

    mockGetSupabase.mockReturnValue(db as never);

    const ids = await getAccessibleGroupIds("user-err-fallback");

    expect(ids).toContain("group-err-fallback");
  });
});
