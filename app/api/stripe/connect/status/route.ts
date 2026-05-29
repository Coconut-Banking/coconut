export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import Stripe from "stripe";
import { getSupabase } from "@/lib/supabase";
import {
  computeTransferEligibility,
  connectFlagsFromStripeAccount,
  fetchStripeConnectedAccountRow,
  persistConnectAccountFlags,
} from "@/lib/stripe-connect-status";

/**
 * GET /api/stripe/connect/status
 * Returns the current user's Stripe Connect onboarding status.
 * Verifies directly against Stripe so polling after onboarding reflects truth
 * even if the account.updated webhook hasn't fired yet.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getSupabase();
  const { data: row } = await fetchStripeConnectedAccountRow(db, userId);

  const cacheHeaders = { headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=300" } };

  if (!row) {
    return NextResponse.json({
      hasAccount: false,
      onboardingComplete: false,
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      requiresVerification: false,
      transferEligibility: computeTransferEligibility({
        hasAccount: false,
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
        requiresVerification: false,
      }),
    }, cacheHeaders);
  }

  // Sync directly from Stripe so polling after onboarding is always fresh
  // (webhook may be delayed or not yet configured on the dashboard)
  const key = process.env.STRIPE_SECRET_KEY;
  if (key) {
    try {
      const stripe = new Stripe(key);
      const account = await stripe.accounts.retrieve(row.stripe_account_id);
      const flags = connectFlagsFromStripeAccount(account);

      const dbPatch = {
        onboarding_complete: flags.onboarding_complete,
        charges_enabled: flags.charges_enabled,
        payouts_enabled: flags.payouts_enabled,
        details_submitted: flags.details_submitted,
      };
      if (
        dbPatch.onboarding_complete !== row.onboarding_complete ||
        dbPatch.charges_enabled !== row.charges_enabled ||
        dbPatch.payouts_enabled !== row.payouts_enabled ||
        dbPatch.details_submitted !== row.details_submitted
      ) {
        await persistConnectAccountFlags(db, row.stripe_account_id, flags);
      }

      const cacheSeconds = flags.transferEligibility === "pending_review" ? 15 : 60;
      return NextResponse.json(
        {
          hasAccount: true,
          accountId: row.stripe_account_id,
          onboardingComplete: flags.onboarding_complete,
          chargesEnabled: flags.charges_enabled,
          payoutsEnabled: flags.payouts_enabled,
          detailsSubmitted: flags.details_submitted,
          requiresVerification: flags.requiresVerification,
          transferEligibility: flags.transferEligibility,
          createdAt: row.created_at,
        },
        { headers: { "Cache-Control": `private, max-age=${cacheSeconds}, stale-while-revalidate=120` } },
      );
    } catch (e) {
      console.error("[stripe-connect] status sync from Stripe failed:", e);
      // Fall through to DB values if Stripe call fails
    }
  }

  const detailsSubmitted = Boolean(row.details_submitted);
  const transferEligibility = computeTransferEligibility({
    hasAccount: true,
    chargesEnabled: row.charges_enabled,
    payoutsEnabled: row.payouts_enabled,
    detailsSubmitted,
    requiresVerification: false,
  });

  return NextResponse.json({
    hasAccount: true,
    accountId: row.stripe_account_id,
    onboardingComplete: row.onboarding_complete,
    chargesEnabled: row.charges_enabled,
    payoutsEnabled: row.payouts_enabled,
    detailsSubmitted,
    requiresVerification: false,
    transferEligibility,
    createdAt: row.created_at,
  }, cacheHeaders);
}
