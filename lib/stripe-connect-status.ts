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
  requirements?: { past_due?: string[] | null; currently_due?: string[] | null } | null;
}): boolean {
  const pastDue = account.requirements?.past_due ?? [];
  const currentlyDue = account.requirements?.currently_due ?? [];
  return pastDue.length > 0 || currentlyDue.length > 0;
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
