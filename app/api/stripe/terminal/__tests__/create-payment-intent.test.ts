import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Tests for POST /api/stripe/terminal/create-payment-intent
 *
 * BUG-CRITICAL-1: Connected Account lookup ran whenever receiverMemberId was
 * present, even when groupId was absent. This meant an attacker could set
 * transfer_data.destination to any platform member's Stripe Connected Account
 * without passing the canAccessGroup auth check.
 *
 * Fix: the Connected Account lookup block now requires
 *   body.receiverMemberId && body.groupId && body.payerMemberId
 * so it only runs after the full group auth check has been validated.
 */

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/group-access", () => ({
  canAccessGroup: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  getSupabase: vi.fn(),
}));

// Stripe mock: use a class so `new Stripe(key)` works.
// The instance methods are spies stored in module-level variables so tests can inspect them.
const mockPaymentIntentsCreate = vi.fn();
const mockAccountsRetrieve = vi.fn();

vi.mock("stripe", () => {
  class MockStripe {
    paymentIntents = { create: mockPaymentIntentsCreate };
    accounts = { retrieve: mockAccountsRetrieve };
    static errors = {
      StripeError: class StripeError extends Error {},
    };
  }
  return { default: MockStripe };
});

import { auth } from "@clerk/nextjs/server";
import { canAccessGroup } from "@/lib/group-access";
import { getSupabase } from "@/lib/supabase";

const mockAuth = vi.mocked(auth);
const mockCanAccessGroup = vi.mocked(canAccessGroup);
const mockGetSupabase = vi.mocked(getSupabase);

import { POST } from "../create-payment-intent/route";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/stripe/terminal/create-payment-intent", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Build a minimal Supabase db mock.
 * receiverUserId: the user_id that group_members returns for receiverMemberId lookups.
 * stripeAccountId: the stripe_account_id that stripe_connected_accounts returns.
 * groupMembersInGroup: rows returned for the "are payer+receiver in the group?" check.
 */
function makeDb(opts: {
  receiverUserId?: string | null;
  stripeAccountId?: string | null;
  groupMembersInGroup?: Array<{ id: string }>;
}) {
  const { receiverUserId = null, stripeAccountId = null, groupMembersInGroup = [] } = opts;

  return {
    from: vi.fn((table: string) => {
      if (table === "group_members") {
        // Two different queries hit this table:
        // 1. .select("id").eq("group_id", ...).in("id", [...]) — group membership check
        // 2. .select("user_id").eq("id", receiverMemberId).maybeSingle() — receiver lookup
        const chain: Record<string, unknown> = {};
        chain.select = vi.fn(() => chain);
        chain.eq = vi.fn(() => chain);
        chain.in = vi.fn(() => Promise.resolve({ data: groupMembersInGroup, error: null }));
        chain.maybeSingle = vi
          .fn()
          .mockResolvedValue({
            data: receiverUserId ? { user_id: receiverUserId } : null,
            error: null,
          });
        return chain;
      }

      if (table === "stripe_connected_accounts") {
        const chain: Record<string, unknown> = {};
        chain.select = vi.fn(() => chain);
        chain.eq = vi.fn(() => chain);
        chain.maybeSingle = vi.fn().mockResolvedValue({
          data: stripeAccountId ? { stripe_account_id: stripeAccountId } : null,
          error: null,
        });
        return chain;
      }

      // Fallback
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn(() => chain);
      chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
      return chain;
    }),
  };
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_placeholder";

  mockAuth.mockResolvedValue({ userId: "clerk_user_test" } as Awaited<
    ReturnType<typeof auth>
  >);

  mockCanAccessGroup.mockResolvedValue(true);

  // Default: Stripe accounts.retrieve returns a US account
  mockAccountsRetrieve.mockResolvedValue({ country: "US" });

  // Default: PaymentIntent create succeeds
  mockPaymentIntentsCreate.mockResolvedValue({
    client_secret: "pi_test_secret",
    id: "pi_test_id",
  });
});

afterEach(() => {
  delete process.env.STRIPE_SECRET_KEY;
  vi.clearAllMocks();
});

// ── BUG-CRITICAL-1 tests ─────────────────────────────────────────────────────

describe("BUG-CRITICAL-1: Connected Account lookup requires groupId + payerMemberId", () => {
  it("does NOT set transfer_data when receiverMemberId is present but groupId is omitted", async () => {
    /**
     * This test FAILS against the old code because the old code runs the
     * Connected Account lookup block whenever body.receiverMemberId is truthy,
     * regardless of groupId. With a valid stripeAccountId returned from the DB,
     * transfer_data.destination would be set.
     *
     * With the fix, the lookup block is skipped when groupId is absent, so
     * transfer_data is never added to the PaymentIntent params.
     */
    const db = makeDb({
      receiverUserId: "victim_user_id",
      stripeAccountId: "acct_victim_stripe",
    });
    mockGetSupabase.mockReturnValue(db as unknown as ReturnType<typeof getSupabase>);

    const req = makeRequest({
      amount: 50,
      // groupId intentionally omitted — simulates the attack
      receiverMemberId: "member_victim_id",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    // The route must have called paymentIntents.create WITHOUT transfer_data
    expect(mockPaymentIntentsCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockPaymentIntentsCreate.mock.calls[0][0] as {
      transfer_data?: { destination: string };
    };
    expect(callArgs.transfer_data).toBeUndefined();

    // The response must report directPayout: false
    const json = await res.json();
    expect(json.directPayout).toBe(false);
  });

  it("does NOT set transfer_data when only receiverMemberId and groupId are present but payerMemberId is omitted", async () => {
    /**
     * The auth block requires ALL THREE: groupId + payerMemberId + receiverMemberId.
     * Omitting payerMemberId bypasses canAccessGroup in the old code — the fix
     * also guards the Connected Account lookup behind the same three-field condition.
     */
    const db = makeDb({
      receiverUserId: "victim_user_id",
      stripeAccountId: "acct_victim_stripe",
    });
    mockGetSupabase.mockReturnValue(db as unknown as ReturnType<typeof getSupabase>);

    const req = makeRequest({
      amount: 100,
      groupId: "group_id_test",
      // payerMemberId intentionally omitted
      receiverMemberId: "member_victim_id",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const callArgs = mockPaymentIntentsCreate.mock.calls[0][0] as {
      transfer_data?: { destination: string };
    };
    expect(callArgs.transfer_data).toBeUndefined();

    const json = await res.json();
    expect(json.directPayout).toBe(false);
  });

  it("DOES set transfer_data when all three fields are present and auth passes", async () => {
    /**
     * Confirms the legitimate path still works after the fix:
     * when groupId + payerMemberId + receiverMemberId are all present,
     * canAccessGroup passes, and the receiver has a Connected Account,
     * transfer_data.destination must be set.
     */
    const db = makeDb({
      receiverUserId: "legit_receiver_user_id",
      stripeAccountId: "acct_legit_stripe",
      groupMembersInGroup: [{ id: "member_payer_id" }, { id: "member_receiver_id" }],
    });
    mockGetSupabase.mockReturnValue(db as unknown as ReturnType<typeof getSupabase>);
    mockCanAccessGroup.mockResolvedValue(true);

    const req = makeRequest({
      amount: 75,
      groupId: "group_id_legit",
      payerMemberId: "member_payer_id",
      receiverMemberId: "member_receiver_id",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const callArgs = mockPaymentIntentsCreate.mock.calls[0][0] as {
      transfer_data?: { destination: string };
    };
    expect(callArgs.transfer_data).toBeDefined();
    expect(callArgs.transfer_data?.destination).toBe("acct_legit_stripe");

    const json = await res.json();
    expect(json.directPayout).toBe(true);
  });

  it("returns 403 when groupId + payerMemberId + receiverMemberId are all present but canAccessGroup rejects", async () => {
    /**
     * Confirms that the group auth check still blocks unauthorized requests
     * when all three fields are provided but the user is not in the group.
     */
    const db = makeDb({});
    mockGetSupabase.mockReturnValue(db as unknown as ReturnType<typeof getSupabase>);
    mockCanAccessGroup.mockResolvedValue(false);

    const req = makeRequest({
      amount: 50,
      groupId: "group_id_forbidden",
      payerMemberId: "member_payer_id",
      receiverMemberId: "member_receiver_id",
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe("Forbidden");
  });
});
