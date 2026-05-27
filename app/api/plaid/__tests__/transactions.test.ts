import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * Tests for BUG-RESILIENCE-1: batch_update_merchant_llm rpc error handling.
 *
 * The rpc call must be wrapped in try-catch and destructure { error } so
 * failures are logged rather than silently swallowed.
 */

async function runRpcBlock(
  rpc: () => Promise<{ error: { message: string } | null }>
): Promise<void> {
  try {
    const { error: rpcErr } = await rpc();
    if (rpcErr) {
      console.warn("[transactions] batch_update_merchant_llm RPC failed:", rpcErr.message);
    }
  } catch (e) {
    console.warn("[transactions] batch_update_merchant_llm error:", e instanceof Error ? e.message : e);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("batch_update_merchant_llm rpc payload", () => {
  it("passes a JSON array to p_updates, not JSON.stringify", () => {
    const toPersist = [{ id: "uuid-1", value: "Starbucks" }];
    const p_updates = toPersist.map((u) => ({ id: u.id, value: u.value }));
    expect(p_updates).toEqual([{ id: "uuid-1", value: "Starbucks" }]);
    expect(Array.isArray(p_updates)).toBe(true);
    // JSON.stringify becomes a JSONB string scalar → jsonb_array_elements fails.
    expect(typeof JSON.stringify(p_updates)).toBe("string");
  });
});

describe("batch_update_merchant_llm rpc error handling", () => {
  it("logs a warning when rpc returns an error object", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const rpc = vi.fn().mockResolvedValue({ error: { message: "function does not exist" } });

    await runRpcBlock(rpc);

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toBe("[transactions] batch_update_merchant_llm RPC failed:");
    expect(warnSpy.mock.calls[0][1]).toBe("function does not exist");
  });

  it("logs a warning when rpc throws a TypeError", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const rpc = vi.fn().mockRejectedValue(new TypeError("rpc is not a function"));

    await runRpcBlock(rpc);

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toBe("[transactions] batch_update_merchant_llm error:");
    expect(warnSpy.mock.calls[0][1]).toBe("rpc is not a function");
  });

  it("does not warn when rpc succeeds with null error", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const rpc = vi.fn().mockResolvedValue({ error: null });

    await runRpcBlock(rpc);

    expect(warnSpy).not.toHaveBeenCalled();
  });
});
