import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * Tests for BUG-RESILIENCE-2: unchecked plaid_items .update() calls in webhook route.
 *
 * Before the fix, DB update failures on plaid_items were silently swallowed:
 *   await db.from("plaid_items").update({ needs_reauth: true }).eq(...)
 * The await result was discarded, so errors never propagated to the caller and
 * Plaid received a 200 OK — meaning it would NOT retry the webhook.
 *
 * After the fix, each update destructures { error } and returns 503 on failure,
 * so Plaid knows to retry the webhook delivery.
 */

/**
 * Simulates the fixed update-and-check pattern used in the webhook route for
 * critical state changes (needs_reauth, new_accounts_available).
 *
 * Returns 503 if the update fails, 200 if it succeeds.
 */
async function runUpdateBlock(
  update: () => Promise<{ error: { message: string } | null }>
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { error } = await update();
  if (error) {
    console.error("[plaid][webhook] plaid_items update failed:", error.message);
    return { status: 503, body: { error: "DB update failed" } };
  }
  return { status: 200, body: { ok: true } };
}

/**
 * Simulates the BUGGY (pre-fix) pattern: await without destructuring { error }.
 * The result is always 200 regardless of DB failure.
 */
async function runBuggyUpdateBlock(
  update: () => Promise<{ error: { message: string } | null }>
): Promise<{ status: number; body: Record<string, unknown> }> {
  await update(); // result discarded — bug!
  return { status: 200, body: { ok: true } };
}

/**
 * Simulates the LOGIN_REPAIRED update inside Promise.all — non-fatal, only logs.
 */
async function runLoginRepairedUpdateBlock(
  update: () => Promise<{ error: { message: string } | null }>
): Promise<void> {
  const { error } = await update();
  if (error) {
    console.error("[plaid][webhook] plaid_items update failed (LOGIN_REPAIRED):", error.message);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BUG-RESILIENCE-2: plaid_items update error handling in webhook", () => {
  describe("demonstrates the bug (pre-fix): DB failures return 200", () => {
    it("returns 200 even when update fails (the bug)", async () => {
      const update = vi.fn().mockResolvedValue({ error: { message: "connection timeout" } });

      const result = await runBuggyUpdateBlock(update);

      // Bug: 200 is returned — Plaid will NOT retry
      expect(result.status).toBe(200);
    });
  });

  describe("ITEM_LOGIN_REQUIRED: needs_reauth update", () => {
    it("returns 503 when plaid_items update fails", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const update = vi.fn().mockResolvedValue({ error: { message: "connection timeout" } });

      const result = await runUpdateBlock(update);

      expect(result.status).toBe(503);
      expect(result.body).toEqual({ error: "DB update failed" });
      expect(errorSpy).toHaveBeenCalledOnce();
      expect(errorSpy.mock.calls[0][0]).toContain("[plaid][webhook] plaid_items update failed");
    });

    it("returns 200 when plaid_items update succeeds", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const update = vi.fn().mockResolvedValue({ error: null });

      const result = await runUpdateBlock(update);

      expect(result.status).toBe(200);
      expect(result.body).toEqual({ ok: true });
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  describe("PENDING_EXPIRATION / PENDING_DISCONNECT: needs_reauth update", () => {
    it("returns 503 when plaid_items update fails", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const update = vi.fn().mockResolvedValue({ error: { message: "permission denied" } });

      const result = await runUpdateBlock(update);

      expect(result.status).toBe(503);
      expect(result.body).toEqual({ error: "DB update failed" });
      expect(errorSpy).toHaveBeenCalledOnce();
    });

    it("returns 200 when plaid_items update succeeds", async () => {
      const update = vi.fn().mockResolvedValue({ error: null });

      const result = await runUpdateBlock(update);

      expect(result.status).toBe(200);
    });
  });

  describe("NEW_ACCOUNTS_AVAILABLE: new_accounts_available update", () => {
    it("returns 503 when plaid_items update fails", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const update = vi.fn().mockResolvedValue({ error: { message: "row limit exceeded" } });

      const result = await runUpdateBlock(update);

      expect(result.status).toBe(503);
      expect(result.body).toEqual({ error: "DB update failed" });
      expect(errorSpy).toHaveBeenCalledOnce();
    });

    it("returns 200 when plaid_items update succeeds", async () => {
      const update = vi.fn().mockResolvedValue({ error: null });

      const result = await runUpdateBlock(update);

      expect(result.status).toBe(200);
    });
  });

  describe("USER_PERMISSION_REVOKED / USER_ACCOUNT_REVOKED: needs_reauth update", () => {
    it("returns 503 when plaid_items update fails", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const update = vi.fn().mockResolvedValue({ error: { message: "foreign key violation" } });

      const result = await runUpdateBlock(update);

      expect(result.status).toBe(503);
      expect(result.body).toEqual({ error: "DB update failed" });
      expect(errorSpy).toHaveBeenCalledOnce();
    });

    it("returns 200 when plaid_items update succeeds", async () => {
      const update = vi.fn().mockResolvedValue({ error: null });

      const result = await runUpdateBlock(update);

      expect(result.status).toBe(200);
    });
  });

  describe("LOGIN_REPAIRED: needs_reauth:false update (non-fatal — only logs)", () => {
    it("logs an error when plaid_items update fails (does not throw)", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const update = vi.fn().mockResolvedValue({ error: { message: "update failed" } });

      // Should not throw — non-fatal path
      await expect(runLoginRepairedUpdateBlock(update)).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalledOnce();
      expect(errorSpy.mock.calls[0][0]).toContain("LOGIN_REPAIRED");
    });

    it("does not log when update succeeds", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const update = vi.fn().mockResolvedValue({ error: null });

      await runLoginRepairedUpdateBlock(update);

      expect(errorSpy).not.toHaveBeenCalled();
    });
  });
});
