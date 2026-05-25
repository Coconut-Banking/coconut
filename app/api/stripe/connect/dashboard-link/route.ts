export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import Stripe from "stripe";
import { getSupabase } from "@/lib/supabase";

/**
 * POST /api/stripe/connect/dashboard-link
 * Opens Stripe Express dashboard for payouts / bank (standard vs instant in Stripe UI).
 */
export async function POST(_req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }

  const db = getSupabase();
  const { data: row } = await db
    .from("stripe_connected_accounts")
    .select("stripe_account_id, charges_enabled")
    .eq("clerk_user_id", userId)
    .maybeSingle();

  if (!row?.stripe_account_id || !row.charges_enabled) {
    return NextResponse.json(
      { error: "Complete payment setup before cashing out." },
      { status: 400 }
    );
  }

  try {
    const stripe = new Stripe(key);
    const link = await stripe.accounts.createLoginLink(row.stripe_account_id);
    return NextResponse.json({ url: link.url });
  } catch (e) {
    const msg = e instanceof Stripe.errors.StripeError ? e.message : "Could not open payout dashboard";
    console.error("[stripe/connect/dashboard-link]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
