import type { SupabaseClient } from "@supabase/supabase-js";

/** User-facing Connect transfer / payout eligibility (Settings, wallet). */
export type TransferEligibility =
  | "none"
  | "setup_required"
  | "action_required"
  | "pending_review"
  | "active";

export function computeTransferEligibility(input: {
  hasAccount: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  requiresVerification: boolean;
}): TransferEligibility {
  if (!input.hasAccount) return "none";
  if (input.payoutsEnabled) return "active";
  if (input.requiresVerification) return "action_required";
  if (input.detailsSubmitted || input.chargesEnabled) return "pending_review";
  return "setup_required";
}

/** Short labels for Settings (Not connected / In review / Connected). */
export const TRANSFER_ELIGIBILITY_LABELS: Record<
  TransferEligibility,
  { title: string; detail: string }
> = {
  none: {
    title: "Not connected",
    detail: "Set up payouts to receive Tap to Pay and transfer to your bank.",
  },
  setup_required: {
    title: "Not connected",
    detail: "Finish bank and identity setup to enable transfers.",
  },
  action_required: {
    title: "Action needed",
    detail: "Stripe needs more information before transfers can be enabled.",
  },
  pending_review: {
    title: "In review",
    detail:
      "Stripe is reviewing your info. Transfers usually unlock in 1–2 business days.",
  },
  active: {
    title: "Connected",
    detail: "Your bank is linked. Tap to Pay and balance can transfer out.",
  },
};

export function stripeAccountRequiresVerification(account: {
  details_submitted?: boolean | null;
  requirements?: { past_due?: string[] | null; currently_due?: string[] | null } | null;
}): boolean {
  const pastDue = account.requirements?.past_due ?? [];
  if (pastDue.length > 0) return true;
  // After the user confirms onboarding, Stripe often keeps items in currently_due
  // while reviewing — that is not "action needed" in the app.
  if (account.details_submitted) return false;
  const currentlyDue = account.requirements?.currently_due ?? [];
  return currentlyDue.length > 0;
}

/** Fields written by account.updated webhook and synced on GET /connect/status. */
export function connectFlagsFromStripeAccount(account: {
  charges_enabled?: boolean | null;
  payouts_enabled?: boolean | null;
  details_submitted?: boolean | null;
  requirements?: { past_due?: string[] | null; currently_due?: string[] | null } | null;
}) {
  const chargesEnabled = account.charges_enabled ?? false;
  const payoutsEnabled = account.payouts_enabled ?? false;
  const detailsSubmitted = account.details_submitted ?? false;
  const requiresVerification = stripeAccountRequiresVerification(account);
  const transferEligibility = computeTransferEligibility({
    hasAccount: true,
    chargesEnabled,
    payoutsEnabled,
    detailsSubmitted,
    requiresVerification,
  });
  return {
    onboarding_complete: chargesEnabled,
    charges_enabled: chargesEnabled,
    payouts_enabled: payoutsEnabled,
    details_submitted: detailsSubmitted,
    requiresVerification,
    transferEligibility,
  };
}

export type ConnectAccountFlags = ReturnType<typeof connectFlagsFromStripeAccount>;

function isMissingDetailsSubmittedColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42703" || /details_submitted/i.test(error.message ?? "");
}

/** Persists Connect flags; retries without details_submitted if migration not applied yet. */
export async function persistConnectAccountFlags(
  db: SupabaseClient,
  stripeAccountId: string,
  flags: ConnectAccountFlags,
) {
  const patch = {
    onboarding_complete: flags.onboarding_complete,
    charges_enabled: flags.charges_enabled,
    payouts_enabled: flags.payouts_enabled,
    details_submitted: flags.details_submitted,
  };
  let { error } = await db
    .from("stripe_connected_accounts")
    .update(patch)
    .eq("stripe_account_id", stripeAccountId);
  if (isMissingDetailsSubmittedColumn(error)) {
    const { details_submitted: _omit, ...withoutDetails } = patch;
    ({ error } = await db
      .from("stripe_connected_accounts")
      .update(withoutDetails)
      .eq("stripe_account_id", stripeAccountId));
  }
  return { error };
}

const CONNECT_ROW_SELECT =
  "stripe_account_id, onboarding_complete, charges_enabled, payouts_enabled, details_submitted, created_at";
const CONNECT_ROW_SELECT_LEGACY =
  "stripe_account_id, onboarding_complete, charges_enabled, payouts_enabled, created_at";

/** Load Connect row; falls back if details_submitted column is not migrated yet. */
export async function fetchStripeConnectedAccountRow(
  db: SupabaseClient,
  clerkUserId: string,
) {
  let result = await db
    .from("stripe_connected_accounts")
    .select(CONNECT_ROW_SELECT)
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();
  if (isMissingDetailsSubmittedColumn(result.error)) {
    result = await db
      .from("stripe_connected_accounts")
      .select(CONNECT_ROW_SELECT_LEGACY)
      .eq("clerk_user_id", clerkUserId)
      .maybeSingle();
    if (result.data) {
      result.data = { ...result.data, details_submitted: false };
    }
  }
  return result;
}
