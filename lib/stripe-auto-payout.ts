import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pickBalanceAmount } from "@/lib/stripe-wallet";

/** Only these thresholds are exposed in settings (prevents arbitrary values). */
export const AUTO_PAYOUT_THRESHOLDS_USD = [25, 50, 100] as const;
export type AutoPayoutThresholdUsd = (typeof AUTO_PAYOUT_THRESHOLDS_USD)[number];

export const DEFAULT_AUTO_PAYOUT_THRESHOLD_USD: AutoPayoutThresholdUsd = 25;

const DEFAULT_MIN_HOURS = 24;

export function isAutoPayoutThresholdUsd(value: number): value is AutoPayoutThresholdUsd {
  return (AUTO_PAYOUT_THRESHOLDS_USD as readonly number[]).includes(value);
}

/** Emergency kill switch on Vercel — when false, no user auto-payouts run. */
export function isPlatformAutoPayoutAllowed(): boolean {
  return process.env.AUTO_PAYOUT_ENABLED !== "false";
}

export function getAutoPayoutMinHours(): number {
  const raw = Number(process.env.AUTO_PAYOUT_MIN_HOURS ?? DEFAULT_MIN_HOURS);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_MIN_HOURS;
}

export type UserAutoPayoutSettings = {
  enabled: boolean;
  thresholdUsd: AutoPayoutThresholdUsd | null;
};

export function resolveUserAutoPayoutSettings(row: {
  auto_payout_enabled?: boolean | null;
  auto_payout_threshold_usd?: number | null;
}): UserAutoPayoutSettings {
  const enabled = Boolean(row.auto_payout_enabled);
  const raw = row.auto_payout_threshold_usd;
  const thresholdUsd =
    raw != null && isAutoPayoutThresholdUsd(raw) ? raw : null;
  return {
    enabled,
    thresholdUsd: enabled ? (thresholdUsd ?? DEFAULT_AUTO_PAYOUT_THRESHOLD_USD) : thresholdUsd,
  };
}

function hoursSince(iso: string | null | undefined): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return (Date.now() - t) / (60 * 60 * 1000);
}

export type AutoPayoutAttemptResult =
  | { status: "skipped"; reason: string }
  | { status: "triggered"; payoutId: string; amountUsd: number; currency: string };

/**
 * When user opted in and available balance >= their threshold, create a standard payout.
 */
export async function tryAutoPayoutForAccount(params: {
  stripe: Stripe;
  db: SupabaseClient;
  stripeAccountId: string;
  clerkUserId: string;
  lastAutoPayoutAt?: string | null;
  userSettings: UserAutoPayoutSettings;
}): Promise<AutoPayoutAttemptResult> {
  if (!isPlatformAutoPayoutAllowed()) {
    return { status: "skipped", reason: "platform_disabled" };
  }

  if (!params.userSettings.enabled || params.userSettings.thresholdUsd == null) {
    return { status: "skipped", reason: "user_disabled" };
  }

  const minHours = getAutoPayoutMinHours();
  if (hoursSince(params.lastAutoPayoutAt) < minHours) {
    return { status: "skipped", reason: "cooldown" };
  }

  const thresholdCents = Math.round(params.userSettings.thresholdUsd * 100);

  let balance: Stripe.Balance;
  try {
    balance = await params.stripe.balance.retrieve({
      stripeAccount: params.stripeAccountId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: "skipped", reason: `balance_failed:${msg}` };
  }

  const { amount: availableUsd, currency } = pickBalanceAmount(balance.available, "usd");
  const availableCents = Math.round(availableUsd * 100);

  if (availableCents < thresholdCents) {
    return { status: "skipped", reason: "below_threshold" };
  }

  const idempotencyKey = `auto_payout_${params.clerkUserId}_${new Date().toISOString().slice(0, 10)}`;

  try {
    const payout = await params.stripe.payouts.create(
      {
        amount: availableCents,
        currency,
        metadata: {
          clerk_user_id: params.clerkUserId,
          source: "coconut_auto_threshold",
          threshold_usd: String(params.userSettings.thresholdUsd),
        },
      },
      {
        stripeAccount: params.stripeAccountId,
        idempotencyKey,
      },
    );

    await params.db
      .from("stripe_connected_accounts")
      .update({ last_auto_payout_at: new Date().toISOString() })
      .eq("stripe_account_id", params.stripeAccountId);

    return {
      status: "triggered",
      payoutId: payout.id,
      amountUsd: availableUsd,
      currency: currency.toUpperCase(),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/already has a pending payout|payout.*in progress/i.test(msg)) {
      return { status: "skipped", reason: "payout_in_progress" };
    }
    if (/insufficient/i.test(msg)) {
      return { status: "skipped", reason: "insufficient_available" };
    }
    throw e;
  }
}

export type AutoPayoutBatchResult = {
  checked: number;
  triggered: number;
  skipped: number;
  errors: number;
};

export async function runAutoPayoutBatch(params: {
  stripe: Stripe;
  db: SupabaseClient;
  limit?: number;
}): Promise<AutoPayoutBatchResult> {
  if (!isPlatformAutoPayoutAllowed()) {
    return { checked: 0, triggered: 0, skipped: 0, errors: 0 };
  }

  const { data: rows, error } = await params.db
    .from("stripe_connected_accounts")
    .select(
      "clerk_user_id, stripe_account_id, last_auto_payout_at, auto_payout_enabled, auto_payout_threshold_usd",
    )
    .eq("payouts_enabled", true)
    .eq("auto_payout_enabled", true)
    .limit(params.limit ?? 30);

  if (error) {
    throw new Error(`auto-payout query failed: ${error.message}`);
  }

  const result: AutoPayoutBatchResult = {
    checked: rows?.length ?? 0,
    triggered: 0,
    skipped: 0,
    errors: 0,
  };

  for (const row of rows ?? []) {
    const userSettings = resolveUserAutoPayoutSettings(row);
    if (!userSettings.enabled) {
      result.skipped += 1;
      continue;
    }

    try {
      const attempt = await tryAutoPayoutForAccount({
        stripe: params.stripe,
        db: params.db,
        stripeAccountId: row.stripe_account_id as string,
        clerkUserId: row.clerk_user_id as string,
        lastAutoPayoutAt: row.last_auto_payout_at as string | null,
        userSettings,
      });
      if (attempt.status === "triggered") {
        result.triggered += 1;
        console.log("[auto-payout] triggered", {
          user: row.clerk_user_id,
          payoutId: attempt.payoutId,
          amountUsd: attempt.amountUsd,
          threshold: userSettings.thresholdUsd,
        });
      } else {
        result.skipped += 1;
      }
    } catch (e) {
      result.errors += 1;
      console.error("[auto-payout] failed for", row.clerk_user_id, e);
    }
  }

  return result;
}
