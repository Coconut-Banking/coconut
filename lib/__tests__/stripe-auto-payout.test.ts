import { describe, it, expect, vi } from "vitest";
import {
  isAutoPayoutThresholdUsd,
  isPlatformAutoPayoutAllowed,
  resolveUserAutoPayoutSettings,
  tryAutoPayoutForAccount,
} from "../stripe-auto-payout";

describe("isAutoPayoutThresholdUsd", () => {
  it("only allows 25, 50, 100", () => {
    expect(isAutoPayoutThresholdUsd(25)).toBe(true);
    expect(isAutoPayoutThresholdUsd(50)).toBe(true);
    expect(isAutoPayoutThresholdUsd(100)).toBe(true);
    expect(isAutoPayoutThresholdUsd(30)).toBe(false);
    expect(isAutoPayoutThresholdUsd(1)).toBe(false);
  });
});

describe("resolveUserAutoPayoutSettings", () => {
  it("defaults to off with no threshold", () => {
    expect(resolveUserAutoPayoutSettings({})).toEqual({
      enabled: false,
      thresholdUsd: null,
    });
  });

  it("when enabled without stored threshold uses $25", () => {
    expect(resolveUserAutoPayoutSettings({ auto_payout_enabled: true })).toEqual({
      enabled: true,
      thresholdUsd: 25,
    });
  });
});

describe("tryAutoPayoutForAccount", () => {
  it("skips when user has not enabled auto payout", async () => {
    const stripe = {
      balance: { retrieve: vi.fn() },
      payouts: { create: vi.fn() },
    } as unknown as import("stripe").default;

    const result = await tryAutoPayoutForAccount({
      stripe,
      db: {} as import("@supabase/supabase-js").SupabaseClient,
      stripeAccountId: "acct_1",
      clerkUserId: "user_1",
      userSettings: { enabled: false, thresholdUsd: null },
    });

    expect(result).toEqual({ status: "skipped", reason: "user_disabled" });
    expect(stripe.balance.retrieve).not.toHaveBeenCalled();
  });

  it("creates payout when user enabled and at or above threshold", async () => {
    const prev = process.env.AUTO_PAYOUT_ENABLED;
    process.env.AUTO_PAYOUT_ENABLED = "true";

    const stripe = {
      balance: {
        retrieve: vi.fn().mockResolvedValue({
          available: [{ amount: 5000, currency: "usd" }],
          pending: [],
        }),
      },
      payouts: {
        create: vi.fn().mockResolvedValue({ id: "po_123" }),
      },
    } as unknown as import("stripe").default;

    const updateEq = vi.fn().mockResolvedValue({});
    const db = {
      from: vi.fn().mockReturnValue({
        update: vi.fn().mockReturnValue({ eq: updateEq }),
      }),
    } as unknown as import("@supabase/supabase-js").SupabaseClient;

    const result = await tryAutoPayoutForAccount({
      stripe,
      db,
      stripeAccountId: "acct_1",
      clerkUserId: "user_1",
      userSettings: { enabled: true, thresholdUsd: 50 },
    });

    expect(result.status).toBe("triggered");
    expect(stripe.payouts.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 5000 }),
      expect.any(Object),
    );

    process.env.AUTO_PAYOUT_ENABLED = prev;
  });
});

describe("isPlatformAutoPayoutAllowed", () => {
  it("is blocked when AUTO_PAYOUT_ENABLED=false", () => {
    const prev = process.env.AUTO_PAYOUT_ENABLED;
    process.env.AUTO_PAYOUT_ENABLED = "false";
    expect(isPlatformAutoPayoutAllowed()).toBe(false);
    process.env.AUTO_PAYOUT_ENABLED = prev;
  });
});
