export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import Stripe from "stripe";
import { getSupabase } from "@/lib/supabase";

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
  const { data: row } = await db
    .from("stripe_connected_accounts")
    .select("stripe_account_id, onboarding_complete, charges_enabled, payouts_enabled, created_at")
    .eq("clerk_user_id", userId)
    .maybeSingle();

  const cacheHeaders = { headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=300" } };

  if (!row) {
    return NextResponse.json({
      hasAccount: false,
      onboardingComplete: false,
      chargesEnabled: false,
      payoutsEnabled: false,
    }, cacheHeaders);
  }

  // Sync directly from Stripe so polling after onboarding is always fresh
  // (webhook may be delayed or not yet configured on the dashboard)
  const key = process.env.STRIPE_SECRET_KEY;
  if (key) {
    try {
      const stripe = new Stripe(key);
      const account = await stripe.accounts.retrieve(row.stripe_account_id);
      const chargesEnabled = account.charges_enabled ?? false;
      const payoutsEnabled = account.payouts_enabled ?? false;
      // charges_enabled is sufficient for routing — payouts may lag in test mode
      const onboardingComplete = chargesEnabled;

      if (
        onboardingComplete !== row.onboarding_complete ||
        chargesEnabled !== row.charges_enabled ||
        payoutsEnabled !== row.payouts_enabled
      ) {
        await db
          .from("stripe_connected_accounts")
          .update({ onboarding_complete: onboardingComplete, charges_enabled: chargesEnabled, payouts_enabled: payoutsEnabled })
          .eq("stripe_account_id", row.stripe_account_id);
      }

      return NextResponse.json({
        hasAccount: true,
        accountId: row.stripe_account_id,
        onboardingComplete,
        chargesEnabled,
        payoutsEnabled,
        createdAt: row.created_at,
      });
    } catch {
      // Fall through to DB values if Stripe call fails
    }
  }

  return NextResponse.json({
    hasAccount: true,
    accountId: row.stripe_account_id,
    onboardingComplete: row.onboarding_complete,
    chargesEnabled: row.charges_enabled,
    payoutsEnabled: row.payouts_enabled,
    createdAt: row.created_at,
  }, cacheHeaders);
}
