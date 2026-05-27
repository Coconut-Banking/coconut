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

/**
 * GET /api/stripe/wallet
 * Coconut account balance: platform-held (pre-Connect) + Stripe Connect balance when set up.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getSupabase();
  const { data: connectRow } = await db
    .from("stripe_connected_accounts")
    .select(
      "stripe_account_id, charges_enabled, payouts_enabled, onboarding_complete, auto_payout_enabled, auto_payout_threshold_usd",
    )
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
  const currency = "USD";
  const coconutHeld = await fetchCoconutHeldForMembers(db, memberIds, currency);

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

  const wallet = computeWalletDisplay({
    currency: balanceCurrency.toUpperCase(),
    coconutHeld,
    stripeAvailable,
    stripePending,
    chargesEnabled,
    payoutsEnabled,
    hasAccount,
    autoPayoutEnabled: connectRow?.auto_payout_enabled,
    autoPayoutThresholdUsd: connectRow?.auto_payout_threshold_usd,
  });

  return NextResponse.json(wallet, {
    headers: {
      "Cache-Control": "private, max-age=15, stale-while-revalidate=60",
    },
  });
}
