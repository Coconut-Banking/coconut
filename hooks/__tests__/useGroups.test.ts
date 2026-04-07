/**
 * Tests for BUG-CLIENT-1 and BUG-CLIENT-2:
 *   - useGroupsSummary.refetch() must reset loading to true before the fetch
 *   - useRecentActivity.refetch() must reset loading to true before the fetch
 *
 * These tests FAIL against old code (loading stays false on refetch) and
 * PASS with the fix (loading becomes true on refetch).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useGroupsSummary, useRecentActivity } from "../useGroups";

// useGroups.ts imports useGroupListen which uses EventSource. Mock it to a no-op.
vi.mock("../useGroupListen", () => ({
  useGroupListen: () => undefined,
}));

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SUMMARY_RESPONSE = {
  groups: [{ id: "g1", name: "Trip", memberCount: 2, myBalance: -10, lastActivityAt: "2026-01-01", imageUrl: null }],
  friends: [],
  totalOwedToMe: 0,
  totalIOwe: 10,
  netBalance: -10,
};

const ACTIVITY_RESPONSE = {
  activity: [
    {
      id: "a1",
      who: "Alice",
      action: "added",
      what: "Dinner",
      in: "Trip",
      direction: "owe" as const,
      amount: 20,
      time: "2026-01-01T00:00:00Z",
    },
  ],
};

function makeControlledFetch() {
  let resolveFirst!: (v: unknown) => void;
  const firstPromise = new Promise<unknown>((res) => { resolveFirst = res; });

  const fetchMock = vi
    .fn()
    // The controlled slow response (used for refetch)
    .mockReturnValueOnce(firstPromise);

  return { fetchMock, resolveFirst };
}

// ---------------------------------------------------------------------------
// BUG-CLIENT-1: useGroupsSummary – loading must reset to true on refetch
// ---------------------------------------------------------------------------

describe("useGroupsSummary – BUG-CLIENT-1: loading resets on refetch", () => {
  it("starts with loading=true on initial mount", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => SUMMARY_RESPONSE,
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useGroupsSummary());

    // loading starts true
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.summary).not.toBeNull();
  });

  it("resets loading to true at the start of refetch (BUG-CLIENT-1)", async () => {
    // Initial fetch resolves immediately
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => SUMMARY_RESPONSE,
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useGroupsSummary());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Second call: slow fetch so we can observe loading mid-flight
    let resolveRefetch!: (v: unknown) => void;
    const refetchPromise = new Promise<unknown>((res) => { resolveRefetch = res; });
    fetchMock.mockReturnValueOnce(refetchPromise);

    // Track loading values observed during refetch
    const loadingValues: boolean[] = [];

    // Kick off refetch without awaiting
    act(() => {
      result.current.refetch();
    });

    // loading must become true immediately (synchronously, before await)
    loadingValues.push(result.current.loading);

    // Now resolve the slow fetch
    resolveRefetch({ ok: true, json: async () => SUMMARY_RESPONSE });
    await waitFor(() => expect(result.current.loading).toBe(false));

    // We captured loading=true while the refetch was in-flight
    expect(loadingValues).toContain(true);
  });

  it("loading transitions: false → true (refetch starts) → false (refetch done)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => SUMMARY_RESPONSE,
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useGroupsSummary());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Confirm initial completed state
    expect(result.current.loading).toBe(false);

    let resolveRefetch!: (v: unknown) => void;
    const refetchPromise = new Promise<unknown>((res) => { resolveRefetch = res; });
    fetchMock.mockReturnValueOnce(refetchPromise);

    act(() => {
      result.current.refetch();
    });

    // loading must be true now (in-flight)
    expect(result.current.loading).toBe(true);

    // Resolve and confirm it goes back to false
    resolveRefetch({ ok: true, json: async () => SUMMARY_RESPONSE });
    await waitFor(() => expect(result.current.loading).toBe(false));
  });
});

// ---------------------------------------------------------------------------
// BUG-CLIENT-2: useRecentActivity – loading must reset to true on refetch
// ---------------------------------------------------------------------------

describe("useRecentActivity – BUG-CLIENT-2: loading resets on refetch", () => {
  it("starts with loading=true on initial mount", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ACTIVITY_RESPONSE,
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useRecentActivity());

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.activity).toHaveLength(1);
  });

  it("resets loading to true at the start of refetch (BUG-CLIENT-2)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ACTIVITY_RESPONSE,
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useRecentActivity());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let resolveRefetch!: (v: unknown) => void;
    const refetchPromise = new Promise<unknown>((res) => { resolveRefetch = res; });
    fetchMock.mockReturnValueOnce(refetchPromise);

    const loadingValues: boolean[] = [];

    act(() => {
      result.current.refetch();
    });

    loadingValues.push(result.current.loading);

    resolveRefetch({ ok: true, json: async () => ACTIVITY_RESPONSE });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(loadingValues).toContain(true);
  });

  it("loading transitions: false → true (refetch starts) → false (refetch done)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ACTIVITY_RESPONSE,
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useRecentActivity());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.loading).toBe(false);

    let resolveRefetch!: (v: unknown) => void;
    const refetchPromise = new Promise<unknown>((res) => { resolveRefetch = res; });
    fetchMock.mockReturnValueOnce(refetchPromise);

    act(() => {
      result.current.refetch();
    });

    // loading must be true now (in-flight)
    expect(result.current.loading).toBe(true);

    resolveRefetch({ ok: true, json: async () => ACTIVITY_RESPONSE });
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it("does NOT reset loading when enabled=false", async () => {
    // When enabled is false, fetchActivity exits early with setLoading(false)
    // and must NOT set loading to true
    vi.stubGlobal("fetch", vi.fn());

    const { result } = renderHook(() => useRecentActivity(false));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Calling refetch when disabled should NOT set loading to true
    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.loading).toBe(false);
    // fetch was never called since enabled=false
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});
