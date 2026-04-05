import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useGroupsSummary, useGroups, useRecentActivity } from "../useGroups";

// useGroupListen opens an EventSource; stub it so tests don't fail in jsdom.
vi.mock("../useGroupListen", () => ({
  useGroupListen: vi.fn(),
}));

const SUMMARY_RESPONSE = {
  groups: [{ id: "g1", name: "Trip", memberCount: 3, myBalance: 10, lastActivityAt: "2026-01-01" }],
  friends: [],
  totalOwedToMe: 10,
  totalIOwe: 0,
  netBalance: 10,
};

const GROUPS_RESPONSE = [
  { id: "g1", name: "Trip", owner_id: "u1", created_at: "2026-01-01" },
];

const ACTIVITY_RESPONSE = { activity: [] };

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeOkFetch(body: unknown) {
  return vi.fn().mockResolvedValue({ ok: true, json: async () => body });
}

// ── useGroupsSummary ─────────────────────────────────────────────────────────

describe("useGroupsSummary – loading resets to true on refetch", () => {
  it("starts with loading=true, then false after initial fetch", async () => {
    vi.stubGlobal("fetch", makeOkFetch(SUMMARY_RESPONSE));

    const { result } = renderHook(() => useGroupsSummary());

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.summary?.groups).toHaveLength(1);
  });

  it("sets loading=true when refetch() is called after initial load", async () => {
    // First call resolves immediately; second call we control manually.
    let resolveSecond!: (v: unknown) => void;
    const secondPromise = new Promise((res) => { resolveSecond = res; });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => SUMMARY_RESPONSE })
      .mockReturnValueOnce(secondPromise);

    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useGroupsSummary());

    // Wait for initial load to complete (loading goes false).
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Kick off refetch — don't await it yet.
    act(() => { result.current.refetch(); });

    // loading must immediately flip back to true.
    expect(result.current.loading).toBe(true);

    // Let the second fetch resolve so state is clean on teardown.
    await act(async () => {
      resolveSecond({ ok: true, json: async () => SUMMARY_RESPONSE });
    });
    expect(result.current.loading).toBe(false);
  });
});

// ── useGroups ────────────────────────────────────────────────────────────────

describe("useGroups – loading resets to true on refetch", () => {
  it("sets loading=true when refetch() is called after initial load", async () => {
    let resolveSecond!: (v: unknown) => void;
    const secondPromise = new Promise((res) => { resolveSecond = res; });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => GROUPS_RESPONSE })
      .mockReturnValueOnce(secondPromise);

    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useGroups());

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => { result.current.refetch(); });

    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolveSecond({ ok: true, json: async () => GROUPS_RESPONSE });
    });
    expect(result.current.loading).toBe(false);
  });
});

// ── useRecentActivity ────────────────────────────────────────────────────────

describe("useRecentActivity – loading resets to true on refetch", () => {
  it("sets loading=true when refetch() is called after initial load", async () => {
    let resolveSecond!: (v: unknown) => void;
    const secondPromise = new Promise((res) => { resolveSecond = res; });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ACTIVITY_RESPONSE })
      .mockReturnValueOnce(secondPromise);

    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useRecentActivity());

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => { result.current.refetch(); });

    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolveSecond({ ok: true, json: async () => ACTIVITY_RESPONSE });
    });
    expect(result.current.loading).toBe(false);
  });
});
