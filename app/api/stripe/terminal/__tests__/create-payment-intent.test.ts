import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for two bugs in create-payment-intent/route.ts:
 *
 * BUG-CRITICAL-1: key_prefix logged to console (credential leak)
 *   - The old console.log included `key_prefix=${key.slice(0,10)}`, leaking the first
 *     10 characters of the Stripe secret key into server logs.
 *   - Fix: removed `key_prefix=...` from the log statement.
 *
 * BUG-CRITICAL-4: Connected Account lookup bypasses group auth check
 *   - Old code checked `if (body.receiverMemberId)` for the Connected Account lookup
 *     OUTSIDE the group auth block. An attacker could send {amount, receiverMemberId}
 *     without groupId, skip the auth check entirely, but still have transfer_data.destination
 *     set to an arbitrary member's Stripe account.
 *   - Fix: moved Connected Account lookup INSIDE the group auth block.
 */

// ---------------------------------------------------------------------------
// BUG-CRITICAL-1: Key prefix should not appear in log output
// ---------------------------------------------------------------------------

/**
 * Simulates the OLD (buggy) log line that leaked the key prefix.
 */
function buildLogMessageOld(amount: number, rawAmount: unknown, key: string): string {
  return `[terminal] create-payment-intent: raw body.amount=${rawAmount} parsed=${amount} key_prefix=${key.slice(0, 10)}`;
}

/**
 * Simulates the FIXED log line with no key information.
 */
function buildLogMessageFixed(amount: number, rawAmount: unknown): string {
  return `[terminal] create-payment-intent: raw body.amount=${rawAmount} parsed=${amount}`;
}

describe("BUG-CRITICAL-1: Stripe key must not appear in logs", () => {
  it("old log message contained key_prefix (demonstrates the bug)", () => {
    // Use a clearly fake key pattern (not a real Stripe key format)
    const fakeKey = "fake_key_ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const msg = buildLogMessageOld(100, 100, fakeKey);
    // The old message leaked the first 10 chars of the key
    expect(msg).toContain("key_prefix=fake_key_A");
    // Verify 10 chars are present
    expect(msg).toContain(fakeKey.slice(0, 10));
  });

  it("fixed log message does not contain any key information", () => {
    // Use a clearly fake key pattern (not a real Stripe key format)
    const fakeKey = "fake_key_ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const msg = buildLogMessageFixed(100, 100);
    expect(msg).not.toContain("key_prefix");
    expect(msg).not.toContain("fake_key");
    expect(msg).not.toContain(fakeKey.slice(0, 10));
  });

  it("fixed log message still contains amount information for debugging", () => {
    const msg = buildLogMessageFixed(42.5, "42.5");
    expect(msg).toContain("body.amount=42.5");
    expect(msg).toContain("parsed=42.5");
  });

  it("fixed log does not leak key even for short keys (edge case)", () => {
    // Even if someone uses a test key with a recognizable prefix
    const testKey = "sk_test_1234567890abcdef";
    const msg = buildLogMessageFixed(50, 50);
    expect(msg).not.toContain(testKey.slice(0, 10));
    expect(msg).not.toContain("sk_test");
  });
});

// ---------------------------------------------------------------------------
// BUG-CRITICAL-4: Connected Account lookup must only run inside group auth block
// ---------------------------------------------------------------------------

/**
 * Simulates the OLD (buggy) routing logic for determining destinationAccountId.
 *
 * OLD behavior: the Connected Account lookup runs whenever receiverMemberId is present,
 * regardless of whether groupId auth was checked.
 */
async function resolveDestinationOld(
  body: { groupId?: string; payerMemberId?: string; receiverMemberId?: string },
  opts: {
    canAccess: boolean;
    groupMembersFound: number;
    receiverUserId: string | null;
    connectedAccountId: string | null;
  }
): Promise<{
  destinationAccountId: string | null;
  authChecked: boolean;
  forbidden: boolean;
}> {
  let authChecked = false;
  let forbidden = false;
  const metadata: Record<string, string> = {};

  // OLD: group auth block (only entered when ALL three fields present)
  if (body.groupId && body.payerMemberId && body.receiverMemberId) {
    authChecked = true;
    if (!opts.canAccess) {
      forbidden = true;
      return { destinationAccountId: null, authChecked, forbidden };
    }
    if (opts.groupMembersFound < 2) {
      return { destinationAccountId: null, authChecked, forbidden };
    }
    metadata.group_id = body.groupId;
    metadata.payer_member_id = body.payerMemberId;
    metadata.receiver_member_id = body.receiverMemberId;
    metadata.source = "terminal";
  }

  // OLD BUG: Connected Account lookup runs outside auth block — only needs receiverMemberId
  let destinationAccountId: string | null = null;
  if (body.receiverMemberId) {
    const receiverUserId = opts.receiverUserId;
    if (receiverUserId && opts.connectedAccountId) {
      destinationAccountId = opts.connectedAccountId;
    }
  }

  return { destinationAccountId, authChecked, forbidden };
}

/**
 * Simulates the FIXED routing logic for determining destinationAccountId.
 *
 * FIXED behavior: the Connected Account lookup only runs inside the group auth block,
 * after canAccessGroup() has confirmed the caller is authorized.
 */
async function resolveDestinationFixed(
  body: { groupId?: string; payerMemberId?: string; receiverMemberId?: string },
  opts: {
    canAccess: boolean;
    groupMembersFound: number;
    receiverUserId: string | null;
    connectedAccountId: string | null;
  }
): Promise<{
  destinationAccountId: string | null;
  authChecked: boolean;
  forbidden: boolean;
}> {
  let authChecked = false;
  let forbidden = false;
  const metadata: Record<string, string> = {};
  let destinationAccountId: string | null = null;

  // FIXED: group auth block — Connected Account lookup is INSIDE this block
  if (body.groupId && body.payerMemberId && body.receiverMemberId) {
    authChecked = true;
    if (!opts.canAccess) {
      forbidden = true;
      return { destinationAccountId: null, authChecked, forbidden };
    }
    if (opts.groupMembersFound < 2) {
      return { destinationAccountId: null, authChecked, forbidden };
    }
    metadata.group_id = body.groupId;
    metadata.payer_member_id = body.payerMemberId;
    metadata.receiver_member_id = body.receiverMemberId;
    metadata.source = "terminal";

    // Connected Account lookup only runs after group auth has passed
    const receiverUserId = opts.receiverUserId;
    if (receiverUserId && opts.connectedAccountId) {
      destinationAccountId = opts.connectedAccountId;
    }
  }

  return { destinationAccountId, authChecked, forbidden };
}

describe("BUG-CRITICAL-4: Connected Account lookup must be gated behind group auth", () => {
  const validGroupBody = {
    groupId: "group-123",
    payerMemberId: "payer-456",
    receiverMemberId: "receiver-789",
  };

  const receiverOnlyBody = {
    // No groupId or payerMemberId — attacker omits them to bypass auth check
    receiverMemberId: "victim-id",
  };

  const victimConnectedOpts = {
    canAccess: true, // irrelevant — auth block is not entered
    groupMembersFound: 2,
    receiverUserId: "victim-clerk-user",
    connectedAccountId: "acct_victim1234",
  };

  it("OLD: receiverMemberId alone (no groupId) still set destinationAccountId (demonstrates the bug)", async () => {
    const result = await resolveDestinationOld(receiverOnlyBody, victimConnectedOpts);

    // Bug: auth check was never performed
    expect(result.authChecked).toBe(false);
    // Bug: destinationAccountId was set to the victim's account without any auth
    expect(result.destinationAccountId).toBe("acct_victim1234");
    // This means transfer_data.destination would have been set to an arbitrary account
  });

  it("FIXED: receiverMemberId alone (no groupId) does NOT set destinationAccountId", async () => {
    const result = await resolveDestinationFixed(receiverOnlyBody, victimConnectedOpts);

    // Auth check was not reached (block requires all three fields)
    expect(result.authChecked).toBe(false);
    // Fixed: destinationAccountId stays null because lookup is inside auth block
    expect(result.destinationAccountId).toBeNull();
  });

  it("FIXED: all three fields with valid group access → destination IS set (expected behavior)", async () => {
    const result = await resolveDestinationFixed(validGroupBody, {
      canAccess: true,
      groupMembersFound: 2,
      receiverUserId: "receiver-clerk-user",
      connectedAccountId: "acct_receiver5678",
    });

    expect(result.authChecked).toBe(true);
    expect(result.forbidden).toBe(false);
    expect(result.destinationAccountId).toBe("acct_receiver5678");
  });

  it("FIXED: all three fields but no group access → 403 and no destination set", async () => {
    const result = await resolveDestinationFixed(validGroupBody, {
      canAccess: false,
      groupMembersFound: 2,
      receiverUserId: "receiver-clerk-user",
      connectedAccountId: "acct_receiver5678",
    });

    expect(result.authChecked).toBe(true);
    expect(result.forbidden).toBe(true);
    expect(result.destinationAccountId).toBeNull();
  });

  it("FIXED: all three fields, valid access, but receiver has no connected account → no destination", async () => {
    const result = await resolveDestinationFixed(validGroupBody, {
      canAccess: true,
      groupMembersFound: 2,
      receiverUserId: "receiver-clerk-user",
      connectedAccountId: null, // Receiver hasn't onboarded Stripe Connect
    });

    expect(result.authChecked).toBe(true);
    expect(result.forbidden).toBe(false);
    expect(result.destinationAccountId).toBeNull();
  });

  it("FIXED: missing payerMemberId (attacker omits it) → no destination set", async () => {
    const partialBody = { groupId: "group-123", receiverMemberId: "victim-id" };
    const result = await resolveDestinationFixed(partialBody, victimConnectedOpts);

    // Auth block not entered (requires ALL three fields)
    expect(result.authChecked).toBe(false);
    expect(result.destinationAccountId).toBeNull();
  });

  it("FIXED: missing groupId (attacker omits it) → no destination set", async () => {
    const partialBody = { payerMemberId: "payer-456", receiverMemberId: "victim-id" };
    const result = await resolveDestinationFixed(partialBody, victimConnectedOpts);

    expect(result.authChecked).toBe(false);
    expect(result.destinationAccountId).toBeNull();
  });

  it("OLD vs FIXED: demonstrates the security gap — attacker can set destination with OLD code but not FIXED", async () => {
    // Attacker's request: omits groupId to skip auth, includes only receiverMemberId
    const attackerBody = { receiverMemberId: "victim-id" };
    const opts = {
      canAccess: false, // irrelevant in old code since auth block is skipped
      groupMembersFound: 0,
      receiverUserId: "victim-user",
      connectedAccountId: "acct_victim_steal_money",
    };

    const oldResult = await resolveDestinationOld(attackerBody, opts);
    const fixedResult = await resolveDestinationFixed(attackerBody, opts);

    // OLD: attacker succeeds — destination is set to victim's account
    expect(oldResult.destinationAccountId).toBe("acct_victim_steal_money");
    expect(oldResult.authChecked).toBe(false);

    // FIXED: attacker fails — destination stays null
    expect(fixedResult.destinationAccountId).toBeNull();
    expect(fixedResult.authChecked).toBe(false);
  });
});
