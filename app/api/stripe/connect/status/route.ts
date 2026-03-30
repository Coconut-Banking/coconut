export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";

/**
 * GET /api/stripe/connect/status
 * Returns the current user's Stripe Connect onboarding status.
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

  if (!row) {
    return NextResponse.json({
      hasAccount: false,
      onboardingComplete: false,
      chargesEnabled: false,
      payoutsEnabled: false,
    });
  }

  return NextResponse.json({
    hasAccount: true,
    accountId: row.stripe_account_id,
    onboardingComplete: row.onboarding_complete,
    chargesEnabled: row.charges_enabled,
    payoutsEnabled: row.payouts_enabled,
    createdAt: row.created_at,
  });
}
