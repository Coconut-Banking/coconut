import { describe, it, expect, vi } from "vitest";

/**
 * Tests for BUG-ONBOARD-1: migrate-token must return { ok: false, reason: "invalid_token" }
 * when itemGet throws a hard Plaid error, and must NOT call savePlaidToken.
 *
 * NOTE: Full route integration testing requires mocking a deep transitive import
 * graph (Clerk, Plaid SDK, Supabase, Next.js cookies/cache). Instead, we extract
 * and test the catch-block decision logic in isolation — the same approach used
 * by exchange-token.test.ts.
 */

// ---------------------------------------------------------------------------
// Extracted catch-block logic (mirrors the fix applied to the route)
// ---------------------------------------------------------------------------

const HARD_INVALID_CODES = new Set([
  "INVALID_ACCESS_TOKEN",
  "ITEM_NOT_FOUND",
  "ITEM_LOCKED",
]);

type ItemGetError = { response?: { data?: { error_code?: string } } };

function handleItemGetError(itemGetErr: unknown): "invalid_token" | "transient" {
  const errData = (itemGetErr as ItemGetError)?.response?.data;
  if (errData?.error_code && HARD_INVALID_CODES.has(errData.error_code)) {
    return "invalid_token";
  }
  return "transient";
}

// ---------------------------------------------------------------------------
// Tests: BUG-ONBOARD-1 — hard Plaid errors must NOT save the token
// ---------------------------------------------------------------------------

describe("migrate-token catch-block logic (BUG-ONBOARD-1)", () => {
  it("classifies INVALID_ACCESS_TOKEN as invalid_token", () => {
    const err = { response: { data: { error_code: "INVALID_ACCESS_TOKEN" } } };
    expect(handleItemGetError(err)).toBe("invalid_token");
  });

  it("classifies ITEM_NOT_FOUND as invalid_token", () => {
    const err = { response: { data: { error_code: "ITEM_NOT_FOUND" } } };
    expect(handleItemGetError(err)).toBe("invalid_token");
  });

  it("classifies ITEM_LOCKED as invalid_token", () => {
    const err = { response: { data: { error_code: "ITEM_LOCKED" } } };
    expect(handleItemGetError(err)).toBe("invalid_token");
  });

  it("classifies a network/transient error as transient", () => {
    const err = new Error("ECONNRESET");
    expect(handleItemGetError(err)).toBe("transient");
  });

  it("classifies an unknown Plaid error code as transient", () => {
    const err = { response: { data: { error_code: "RATE_LIMIT_EXCEEDED" } } };
    expect(handleItemGetError(err)).toBe("transient");
  });

  it("classifies an error with no response data as transient", () => {
    const err = { response: {} };
    expect(handleItemGetError(err)).toBe("transient");
  });

  it("classifies null as transient", () => {
    expect(handleItemGetError(null)).toBe("transient");
  });
});

// ---------------------------------------------------------------------------
// Simulate the route's conditional save — savePlaidToken must NOT be called
// for hard Plaid errors
// ---------------------------------------------------------------------------

async function simulateMigrateTokenCatch(
  itemGetErr: unknown,
  savePlaidToken: () => Promise<void>,
): Promise<{ ok: boolean; reason?: string }> {
  const outcome = handleItemGetError(itemGetErr);
  if (outcome === "invalid_token") {
    return { ok: false, reason: "invalid_token" };
  }
  await savePlaidToken();
  return { ok: true };
}

describe("migrate-token route simulation (BUG-ONBOARD-1)", () => {
  it("returns { ok: false, reason: 'invalid_token' } for INVALID_ACCESS_TOKEN and does NOT call savePlaidToken", async () => {
    const savePlaidToken = vi.fn().mockResolvedValue(undefined);
    const err = { response: { data: { error_code: "INVALID_ACCESS_TOKEN" } } };

    const result = await simulateMigrateTokenCatch(err, savePlaidToken);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("invalid_token");
    expect(savePlaidToken).not.toHaveBeenCalled();
  });

  it("returns { ok: false, reason: 'invalid_token' } for ITEM_NOT_FOUND and does NOT call savePlaidToken", async () => {
    const savePlaidToken = vi.fn().mockResolvedValue(undefined);
    const err = { response: { data: { error_code: "ITEM_NOT_FOUND" } } };

    const result = await simulateMigrateTokenCatch(err, savePlaidToken);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("invalid_token");
    expect(savePlaidToken).not.toHaveBeenCalled();
  });

  it("returns { ok: false, reason: 'invalid_token' } for ITEM_LOCKED and does NOT call savePlaidToken", async () => {
    const savePlaidToken = vi.fn().mockResolvedValue(undefined);
    const err = { response: { data: { error_code: "ITEM_LOCKED" } } };

    const result = await simulateMigrateTokenCatch(err, savePlaidToken);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("invalid_token");
    expect(savePlaidToken).not.toHaveBeenCalled();
  });

  it("calls savePlaidToken for transient errors (not a hard invalid code)", async () => {
    const savePlaidToken = vi.fn().mockResolvedValue(undefined);
    const err = new Error("socket hang up");

    const result = await simulateMigrateTokenCatch(err, savePlaidToken);

    expect(result.ok).toBe(true);
    expect(savePlaidToken).toHaveBeenCalledOnce();
  });
});
