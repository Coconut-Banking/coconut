import type { SupabaseClient } from "@supabase/supabase-js";
import { sumSettlementAmounts } from "@/lib/stripe-wallet";

export type WalletDisplay = {
  currency: string;
  coconutHeld: number;
  stripeAvailable: number | null;
  stripePending: number | null;
  /** Primary headline — Connect available balance, or platform-held before setup. */
  available: number;
  pending: number;
  /** All real money collected (Connect + platform-held). */
  totalCollected: number;
  hasAccount: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  canCashOut: boolean;
  canSetupPayouts: boolean;
};

export async function fetchCoconutHeldForMembers(
  db: SupabaseClient,
  memberIds: string[],
  currency = "USD",
): Promise<number> {
  if (memberIds.length === 0) return 0;

  const { data: settlements } = await db
    .from("settlements")
    .select("amount, iso_currency_code")
    .in("receiver_member_id", memberIds)
    .eq("status", "completed")
    .eq("method", "stripe")
    .not("external_reference", "is", null);

  return sumSettlementAmounts(settlements ?? [], currency);
}

export function computeWalletDisplay(params: {
  currency: string;
  coconutHeld: number;
  stripeAvailable: number | null;
  stripePending: number | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  hasAccount: boolean;
}): WalletDisplay {
  const stripeAvail = params.stripeAvailable ?? 0;
  const stripePend = params.stripePending ?? 0;

  const available =
    params.chargesEnabled && params.stripeAvailable != null
      ? stripeAvail
      : params.coconutHeld;

  const pending = params.chargesEnabled ? stripePend : 0;
  const totalCollected =
    Math.round((params.coconutHeld + stripeAvail + stripePend) * 100) / 100;

  return {
    currency: params.currency,
    coconutHeld: params.coconutHeld,
    stripeAvailable: params.stripeAvailable,
    stripePending: params.stripePending,
    available,
    pending,
    totalCollected,
    hasAccount: params.hasAccount,
    chargesEnabled: params.chargesEnabled,
    payoutsEnabled: params.payoutsEnabled,
    canCashOut: params.chargesEnabled && params.payoutsEnabled && params.hasAccount,
    canSetupPayouts: !params.chargesEnabled || !params.payoutsEnabled,
  };
}
