import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for saveDetectedSubscriptions error propagation.
 * BUG-RESILIENCE-1: .update()/.upsert() calls inside Promise.all() were missing
 * error destructuring, silently swallowing Supabase DB errors.
 *
 * BUG-CRITICAL-2: deleteExcludedSubscriptions SELECT missing { error } destructuring —
 * a DB failure silently returned 0 instead of throwing.
 */

// Configurable mock functions — reset in beforeEach
const mockSelectResult = vi.fn();
const mockUpdateResult = vi.fn();
const mockUpsertResult = vi.fn();
const mockDeleteResult = vi.fn();

/**
 * Build a fully chainable Supabase query builder that terminates with a
 * given result mock. Every builder method (eq, neq, in, order, select,
 * update, upsert) returns the same chain so any call sequence resolves.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeChainable(terminal: (...args: any[]) => any): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: Record<string, (...args: any[]) => any> = {};
  const methods = ["eq", "neq", "in", "order", "select", "update", "upsert", "lt", "gte"];
  for (const m of methods) {
    chain[m] = () => chain;
  }
  // Make the chain itself thenable so `await chain` resolves via the terminal mock.
  chain["then"] = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    terminal().then(resolve, reject);
  return chain;
}

vi.mock("../supabase", () => ({
  getSupabase: () => ({
    from: (table: string) => {
      if (table === "subscriptions") {
        return {
          // Phase 1 select — batch fetch existing subs: .select().eq().in()
          select: () => makeChainable(mockSelectResult),
          // Update path (Phase 2)
          update: (_data: unknown) => makeChainable(mockUpdateResult),
          // Upsert path (Phase 2 new subs, and Phase 3 subscription_transactions)
          upsert: (_rows: unknown, _opts?: unknown) => makeChainable(mockUpsertResult),
          // Delete path (deleteExcludedSubscriptions)
          delete: () => makeChainable(mockDeleteResult),
        };
      }
      // subscription_transactions and transactions tables — safe no-ops
      const noop = vi.fn().mockResolvedValue({ data: null, error: null });
      return {
        select: () => makeChainable(vi.fn().mockResolvedValue({ data: [], error: null })),
        upsert: () => makeChainable(noop),
        delete: () => makeChainable(noop),
      };
    },
  }),
}));

import { saveDetectedSubscriptions, deleteExcludedSubscriptions } from "../subscription-detect";
import type { DetectedSubscription } from "../subscription-detect";

function makeDetected(overrides?: Partial<DetectedSubscription>): DetectedSubscription {
  return {
    merchantName: "Netflix",
    normalizedMerchant: "netflix",
    amount: 15.99,
    frequency: "monthly",
    lastChargeDate: "2025-03-01",
    nextDueDate: "2025-04-01",
    primaryCategory: "SUBSCRIPTIONS",
    transactionCount: 3,
    transactionIds: [],
    transactionDetails: [],
    source: "known",
    confidence: 0.95,
    ...overrides,
  };
}

describe("saveDetectedSubscriptions — error propagation (BUG-RESILIENCE-1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteResult.mockResolvedValue({ data: null, error: null });
  });

  describe("empty detected list", () => {
    it("returns immediately without touching the DB", async () => {
      await expect(saveDetectedSubscriptions("user-1", [])).resolves.toBeUndefined();
      expect(mockSelectResult).not.toHaveBeenCalled();
      expect(mockUpdateResult).not.toHaveBeenCalled();
      expect(mockUpsertResult).not.toHaveBeenCalled();
    });
  });

  describe("update path — existing subscription", () => {
    it("resolves silently when the update succeeds", async () => {
      mockSelectResult.mockResolvedValue({
        data: [{ id: "sub-1", status: "active", amount: 14.99, normalized_merchant: "netflix" }],
        error: null,
      });
      mockUpdateResult.mockResolvedValue({ data: null, error: null });

      await expect(
        saveDetectedSubscriptions("user-1", [makeDetected()])
      ).resolves.toBeUndefined();
    });

    it("throws when the Supabase update returns an error (BUG: was silently swallowed)", async () => {
      // Existing record — triggers UPDATE path
      mockSelectResult.mockResolvedValue({
        data: [{ id: "sub-1", status: "active", amount: 14.99, normalized_merchant: "netflix" }],
        error: null,
      });
      // Simulate a DB error on update
      mockUpdateResult.mockResolvedValue({
        data: null,
        error: { message: "update constraint violation" },
      });

      await expect(
        saveDetectedSubscriptions("user-1", [makeDetected()])
      ).rejects.toThrow("Failed to update subscription sub-1: update constraint violation");
    });

    it("throws when one of multiple updates fails", async () => {
      mockSelectResult.mockResolvedValue({
        data: [
          { id: "sub-1", status: "active", amount: 14.99, normalized_merchant: "netflix" },
          { id: "sub-2", status: "active", amount: 9.99, normalized_merchant: "spotify" },
        ],
        error: null,
      });
      // First update OK, second fails
      mockUpdateResult
        .mockResolvedValueOnce({ data: null, error: null })
        .mockResolvedValueOnce({ data: null, error: { message: "row lock timeout" } });

      const detected = [
        makeDetected({ normalizedMerchant: "netflix", merchantName: "Netflix" }),
        makeDetected({ normalizedMerchant: "spotify", merchantName: "Spotify", amount: 9.99 }),
      ];
      await expect(saveDetectedSubscriptions("user-1", detected)).rejects.toThrow(
        "row lock timeout"
      );
    });
  });

  describe("upsert path — new subscription", () => {
    it("resolves silently when the upsert succeeds", async () => {
      // No existing record — triggers upsert path
      mockSelectResult.mockResolvedValue({ data: [], error: null });
      mockUpsertResult.mockResolvedValue({ data: null, error: null });

      await expect(
        saveDetectedSubscriptions("user-1", [makeDetected()])
      ).resolves.toBeUndefined();
    });

    it("throws when the Supabase upsert returns an error (BUG: was silently swallowed)", async () => {
      // No existing record — triggers upsert path
      mockSelectResult.mockResolvedValue({ data: [], error: null });
      // Simulate a DB error on upsert
      mockUpsertResult.mockResolvedValue({
        data: null,
        error: { message: "duplicate key violation" },
      });

      await expect(
        saveDetectedSubscriptions("user-1", [makeDetected()])
      ).rejects.toThrow("Failed to upsert subscriptions: duplicate key violation");
    });
  });

  describe("dismissed subscription", () => {
    it("skips update/upsert for a dismissed subscription", async () => {
      mockSelectResult.mockResolvedValue({
        data: [{ id: "sub-3", status: "dismissed", amount: 15.99, normalized_merchant: "netflix" }],
        error: null,
      });

      await saveDetectedSubscriptions("user-1", [makeDetected()]);

      // No update or upsert should be called
      expect(mockUpdateResult).not.toHaveBeenCalled();
      expect(mockUpsertResult).not.toHaveBeenCalled();
    });
  });
});

describe("deleteExcludedSubscriptions — SELECT error handling (BUG-CRITICAL-2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteResult.mockResolvedValue({ data: null, error: null });
  });

  it("throws when the Supabase SELECT returns an error (BUG: was silently returning 0)", async () => {
    // Simulate a DB error on the initial SELECT
    mockSelectResult.mockResolvedValue({
      data: null,
      error: { message: "permission denied for table subscriptions" },
    });

    await expect(deleteExcludedSubscriptions("user-1")).rejects.toThrow(
      "Failed to load subscriptions: permission denied for table subscriptions"
    );
  });

  it("returns 0 when the SELECT returns an empty list (no active subscriptions)", async () => {
    mockSelectResult.mockResolvedValue({ data: [], error: null });

    await expect(deleteExcludedSubscriptions("user-1")).resolves.toBe(0);
  });
});
