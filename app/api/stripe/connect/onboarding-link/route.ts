export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import Stripe from "stripe";
import { getSupabase } from "@/lib/supabase";

/**
 * POST /api/stripe/connect/onboarding-link
 * Generates a fresh Stripe Account Link for users who started but didn't finish onboarding.
 */
export async function POST(req: Request) {
  const [{ userId }, body] = await Promise.all([
    auth(),
    req.json().catch(() => ({})),
  ]);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }

  const scheme = (body as { scheme?: string }).scheme ?? "coconut";

  try {
    const db = getSupabase();
    const { data: row, error: selectError } = await db
      .from("stripe_connected_accounts")
      .select("stripe_account_id")
      .eq("clerk_user_id", userId)
      .maybeSingle();

    if (selectError) {
      console.error("[stripe-connect] db select failed:", selectError);
      return NextResponse.json({ error: "Database error: " + selectError.message }, { status: 500 });
    }

    if (!row) {
      return NextResponse.json(
        { error: "No connected account. Use create-account first." },
        { status: 404 }
      );
    }

    const stripe = new Stripe(key);
    const appUrl = process.env.APP_URL ?? "https://coconut-app.dev";

    const accountLink = await stripe.accountLinks.create({
      account: row.stripe_account_id,
      refresh_url: `${appUrl}/api/stripe/connect/onboarding-refresh?account_id=${row.stripe_account_id}&scheme=${scheme}`,
      return_url: `${appUrl}/api/stripe/connect/onboarding-return?account_id=${row.stripe_account_id}&scheme=${scheme}`,
      type: "account_onboarding",
    });

    return NextResponse.json({ url: accountLink.url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[stripe-connect] onboarding-link error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
