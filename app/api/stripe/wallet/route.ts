export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import Stripe from "stripe";
import { getSupabase } from "@/lib/supabase";
import {
  pickBalanceAmount,
  sumSettlementAmounts,
} from "@/lib/stripe-wallet";

/**
 * GET /api/stripe/wallet
 * Coconut account balance: held on platform (pre-Connect) + Stripe Connect balance when set up.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getSupabase();
  const { data: connectRow } = await db
    .from("stripe_connected_accounts")
    .select("stripe_account_id, charges_enabled, payouts_enabled, onboarding_complete")
    .eq("clerk_user_id", userId)
    .maybeSingle();

  const chargesEnabled = Boolean(connectRow?.charges_enabled);
  const payoutsEnabled = Boolean(connectRow?.payouts_enabled);
  const hasAccount = Boolean(connectRow?.stripe_account_id);

  const { data: memberRows } = await db
    .from("group_members")
    .select("id")
    .eq("user_id", userId);

  const memberIds = (memberRows ?? []).map((m) => m.id);
  let coconutHeld = 0;
  const currency = "USD";

  if (memberIds.length > 0 && !chargesEnabled) {
    const { data: settlements } = await db
      .from("settlements")
      .select("amount, iso_currency_code")
      .in("receiver_member_id", memberIds)
      .eq("status", "completed")
      .eq("method", "stripe")
      .not("external_reference", "is", null);

    coconutHeld = sumSettlementAmounts(settlements ?? [], currency);
  }

  let stripeAvailable: number | null = null;
  let stripePending: number | null = null;
  let balanceCurrency = currency.toLowerCase();

  const key = process.env.STRIPE_SECRET_KEY;
  if (key && connectRow?.stripe_account_id && chargesEnabled) {
    try {
      const stripe = new Stripe(key);
      const balance = await stripe.balance.retrieve({
        stripeAccount: connectRow.stripe_account_id,
      });
      const avail = pickBalanceAmount(balance.available, balanceCurrency);
      const pend = pickBalanceAmount(balance.pending, balanceCurrency);
      stripeAvailable = avail.amount;
      stripePending = pend.amount;
      balanceCurrency = avail.currency;
    } catch (e) {
      console.warn("[stripe/wallet] balance.retrieve failed:", e);
    }
  }

  const displayAvailable =
    chargesEnabled && stripeAvailable != null
      ? stripeAvailable
      : coconutHeld;
  const displayPending = chargesEnabled ? (stripePending ?? 0) : 0;

  return NextResponse.json(
    {
      currency: balanceCurrency.toUpperCase(),
      coconutHeld,
      stripeAvailable,
      stripePending,
      /** Primary number for UI — Connect available or held on Coconut. */
      available: displayAvailable,
      pending: displayPending,
      hasAccount,
      chargesEnabled,
      payoutsEnabled,
      canCashOut: chargesEnabled && hasAccount,
      canSetupPayouts: !chargesEnabled || !payoutsEnabled,
    },
    {
      headers: {
        "Cache-Control": "private, max-age=15, stale-while-revalidate=60",
      },
    }
  );
}
