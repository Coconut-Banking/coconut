export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import Stripe from "stripe";
import { getSupabase } from "@/lib/supabase";
import { pickBalanceAmount } from "@/lib/stripe-wallet";
import {
  computeWalletDisplay,
  fetchCoconutHeldForMembers,
} from "@/lib/stripe-wallet-response";
import {
  connectFlagsFromStripeAccount,
  fetchStripeConnectedAccountRow,
  persistConnectAccountFlags,
} from "@/lib/stripe-connect-status";

/**
 * GET /api/stripe/wallet
 * Coconut account balance: platform-held (pre-Connect) + Stripe Connect balance when set up.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getSupabase();
  const { data: connectRow } = await fetchStripeConnectedAccountRow(db, userId);

  let autoPayoutEnabled: boolean | undefined;
  let autoPayoutThresholdUsd: number | null | undefined;
  if (connectRow?.stripe_account_id) {
    const { data: payoutPrefs } = await db
      .from("stripe_connected_accounts")
      .select("auto_payout_enabled, auto_payout_threshold_usd")
      .eq("stripe_account_id", connectRow.stripe_account_id)
      .maybeSingle();
    autoPayoutEnabled = payoutPrefs?.auto_payout_enabled;
    autoPayoutThresholdUsd = payoutPrefs?.auto_payout_threshold_usd;
  }

  let chargesEnabled = Boolean(connectRow?.charges_enabled);
  let payoutsEnabled = Boolean(connectRow?.payouts_enabled);
  const hasAccount = Boolean(connectRow?.stripe_account_id);

  const key = process.env.STRIPE_SECRET_KEY;
  if (key && connectRow?.stripe_account_id) {
    try {
      const stripe = new Stripe(key);
      const account = await stripe.accounts.retrieve(connectRow.stripe_account_id);
      const flags = connectFlagsFromStripeAccount(account);
      chargesEnabled = flags.charges_enabled;
      payoutsEnabled = flags.payouts_enabled;
      if (
        flags.charges_enabled !== connectRow.charges_enabled ||
        flags.payouts_enabled !== connectRow.payouts_enabled ||
        flags.details_submitted !== connectRow.details_submitted
      ) {
        await persistConnectAccountFlags(db, connectRow.stripe_account_id, flags);
      }
    } catch (e) {
      console.warn("[stripe/wallet] account sync failed:", e);
    }
  }

  const { data: memberRows } = await db
    .from("group_members")
    .select("id")
    .eq("user_id", userId);

  const memberIds = (memberRows ?? []).map((m) => m.id);
  const currency = "USD";
  const coconutHeld = await fetchCoconutHeldForMembers(db, memberIds, currency);

  let stripeAvailable: number | null = null;
  let stripePending: number | null = null;
  let balanceCurrency = currency.toLowerCase();

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

  const wallet = computeWalletDisplay({
    currency: balanceCurrency.toUpperCase(),
    coconutHeld,
    stripeAvailable,
    stripePending,
    chargesEnabled,
    payoutsEnabled,
    hasAccount,
    autoPayoutEnabled,
    autoPayoutThresholdUsd,
  });

  return NextResponse.json(wallet, {
    headers: {
      "Cache-Control": "private, max-age=15, stale-while-revalidate=60",
    },
  });
}
