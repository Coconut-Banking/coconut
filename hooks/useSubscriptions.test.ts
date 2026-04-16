import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useSubscriptions } from "./useSubscriptions";

// Minimal subscription fixture
const SUB = {
  id: "sub-1",
  merchant: "Netflix",
  amount: 15.99,
  frequency: "monthly",
  lastCharged: null,
  nextDue: null,
  category: "Entertainment",
  transactionCount: 3,
  status: "active",
  confidence: 0.9,
  priceChange: { previous: 13.99, change: 2, detectedAt: "2026-01-01" },
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeOkFetch(body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => body,
  });
}

function makeFailFetch(body: unknown = { error: "server error" }) {
  return vi.fn().mockResolvedValue({
    ok: false,
    json: async () => body,
  });
}

describe("useSubscriptions – dismiss mountedRef guard", () => {
  it("does not call fetchSubs after unmount when PATCH fails (dismiss)", async () => {
    // First call: initial load returns one subscription
    // Second call: PATCH returns error (would trigger fetchSubs)
    // Third call: would be fetchSubs – should NOT happen after unmount
    const fetchMock = vi
      .fn()
      // initial GET /api/subscriptions
      .mockResolvedValueOnce({ ok: true, json: async () => [SUB] })
      // PATCH /api/subscriptions/sub-1 → error to trigger the fetchSubs path
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "fail" }) })
      // This would be the re-fetch after error – should not be reached after unmount
      .mockResolvedValueOnce({ ok: true, json: async () => [] });

    vi.stubGlobal("fetch", fetchMock);

    const { result, unmount } = renderHook(() => useSubscriptions());

    // Wait for initial load
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.subscriptions).toHaveLength(1);

    // Unmount before dismiss resolves – we need to unmount while PATCH is in-flight
    // Strategy: make the PATCH response slow so we can unmount first
    let resolvePatch!: (v: unknown) => void;
    const patchPromise = new Promise((res) => { resolvePatch = res; });

    fetchMock
      .mockReset()
      // PATCH is slow – we control when it resolves
      .mockReturnValueOnce(patchPromise)
      // re-fetch that must NOT be called
      .mockResolvedValueOnce({ ok: true, json: async () => [] });

    // Start dismiss (don't await yet)
    let dismissDone = false;
    act(() => {
      result.current.dismiss("sub-1").then(() => { dismissDone = true; });
    });

    // Unmount while PATCH is still pending
    unmount();

    // Now resolve the PATCH with an error response
    resolvePatch({ ok: false, json: async () => ({ error: "fail" }) });

    // Give microtasks/promises time to settle
    await new Promise((r) => setTimeout(r, 50));

    // fetchSubs (the third fetch call) must NOT have been invoked after unmount
    // fetch was called once for the PATCH; if mountedRef guard works, no second call
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(dismissDone).toBe(true);
  });

  it("does not call fetchSubs after unmount when PATCH throws (dismiss)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [SUB] });

    vi.stubGlobal("fetch", fetchMock);

    const { result, unmount } = renderHook(() => useSubscriptions());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let resolvePatch!: (v: unknown) => void;
    const patchPromise = new Promise((_, rej) => { resolvePatch = rej; });

    fetchMock
      .mockReset()
      .mockReturnValueOnce(patchPromise)
      // re-fetch that must NOT be called
      .mockResolvedValueOnce({ ok: true, json: async () => [] });

    act(() => {
      result.current.dismiss("sub-1").catch(() => {});
    });

    unmount();

    // Reject the PATCH (network error)
    resolvePatch(new Error("network error"));

    await new Promise((r) => setTimeout(r, 50));

    // Only the one PATCH call; no follow-up fetchSubs
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not call fetchSubs after unmount when PATCH fails (dismissPriceChange)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [SUB] });

    vi.stubGlobal("fetch", fetchMock);

    const { result, unmount } = renderHook(() => useSubscriptions());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let resolvePatch!: (v: unknown) => void;
    const patchPromise = new Promise((res) => { resolvePatch = res; });

    fetchMock
      .mockReset()
      .mockReturnValueOnce(patchPromise)
      .mockResolvedValueOnce({ ok: true, json: async () => [] });

    act(() => {
      result.current.dismissPriceChange("sub-1");
    });

    unmount();

    resolvePatch({ ok: false, json: async () => ({ error: "fail" }) });

    await new Promise((r) => setTimeout(r, 50));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sets loading=true at the start of detect() before the refetch", async () => {
    // Initial load: returns one subscription
    // POST (detect): resolves ok
    // GET refetch (fetchSubs): we control timing to observe loading state mid-flight
    let resolveRefetch!: (v: unknown) => void;
    const refetchPromise = new Promise((res) => { resolveRefetch = res; });

    const fetchMock = vi
      .fn()
      // initial GET
      .mockResolvedValueOnce({ ok: true, json: async () => [SUB] })
      // POST detect
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      // GET refetch – slow so we can observe loading mid-flight
      .mockReturnValueOnce(refetchPromise);

    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSubscriptions());

    // Wait for initial load to complete
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Start detect – do not await so we can inspect state while it's in-flight
    act(() => {
      result.current.detect();
    });

    // After detect() starts, loading must be true before the refetch resolves
    await waitFor(() => expect(result.current.loading).toBe(true));

    // Also detecting should be true at the same time
    expect(result.current.detecting).toBe(true);

    // Resolve the pending refetch to clean up
    resolveRefetch({ ok: true, json: async () => [] });

    // Wait for detect to finish (detecting goes back to false)
    await waitFor(() => expect(result.current.detecting).toBe(false));
  });

  it("resets loading to false after detect() receives a non-200 response", async () => {
    const fetchMock = vi
      .fn()
      // initial GET
      .mockResolvedValueOnce({ ok: true, json: async () => [SUB] })
      // POST detect returns non-200
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Detection failed. Please try again." }) });

    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSubscriptions());

    // Wait for initial load to complete
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Trigger detect and wait for it to finish
    await act(async () => {
      await result.current.detect();
    });

    // loading must be false after the failed detect() call
    expect(result.current.loading).toBe(false);
    // detecting must also be false
    expect(result.current.detecting).toBe(false);
    // error should be set
    expect(result.current.error).toBe("Detection failed. Please try again.");
  });

  it("resets loading to false after detect() throws a network error", async () => {
    const fetchMock = vi
      .fn()
      // initial GET
      .mockResolvedValueOnce({ ok: true, json: async () => [SUB] })
      // POST detect throws
      .mockRejectedValueOnce(new Error("network error"));

    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSubscriptions());

    // Wait for initial load to complete
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Trigger detect and wait for it to finish
    await act(async () => {
      await result.current.detect();
    });

    // loading must be false after the network error
    expect(result.current.loading).toBe(false);
    // detecting must also be false
    expect(result.current.detecting).toBe(false);
  });

  it("calls fetchSubs when PATCH fails and component is still mounted (dismiss)", async () => {
    const fetchMock = vi
      .fn()
      // initial load
      .mockResolvedValueOnce({ ok: true, json: async () => [SUB] })
      // PATCH fails
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "fail" }) })
      // re-fetch after error
      .mockResolvedValueOnce({ ok: true, json: async () => [] });

    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSubscriptions());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.dismiss("sub-1");
    });

    // All three calls should have been made: initial load + PATCH + re-fetch
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.current.subscriptions).toHaveLength(0);
  });
});
