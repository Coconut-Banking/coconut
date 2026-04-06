export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import Stripe from "stripe";
import { getSupabase } from "@/lib/supabase";

/**
 * POST /api/stripe/connect/create-account
 * Creates a Stripe Express connected account for the current user and returns
 * an Account Link URL for hosted onboarding. If the user already has an account,
 * returns a fresh onboarding link instead.
 */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const scheme = (body as { scheme?: string }).scheme ?? "coconut";

  try {
    const stripe = new Stripe(key);
    const db = getSupabase();

    const { data: existing, error: selectError } = await db
      .from("stripe_connected_accounts")
      .select("stripe_account_id, onboarding_complete")
      .eq("clerk_user_id", userId)
      .maybeSingle();

    if (selectError) {
      console.error("[stripe-connect] db select failed:", selectError);
      return NextResponse.json({ error: "Database error: " + selectError.message }, { status: 500 });
    }

    let accountId: string;

    if (existing) {
      accountId = existing.stripe_account_id;
    } else {
      const user = await currentUser();
      const email = user?.emailAddresses?.[0]?.emailAddress ?? undefined;

      const account = await stripe.accounts.create({
        type: "express",
        email,
        business_type: "individual",
        business_profile: {
          url: "https://coconut-app.dev",
          mcc: "7372", // Software — personal finance app
          product_description: "Peer-to-peer expense splitting and payments via the Coconut app",
        },
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        settings: {
          payouts: {
            schedule: { interval: "daily" },
          },
        },
        metadata: { clerk_user_id: userId },
      });

      const { error: insertError } = await db
        .from("stripe_connected_accounts")
        .insert({
          clerk_user_id: userId,
          stripe_account_id: account.id,
          onboarding_complete: false,
          charges_enabled: false,
          payouts_enabled: false,
        });

      if (insertError) {
        console.error("[stripe-connect] insert failed:", insertError);
        return NextResponse.json({ error: "Failed to save account: " + insertError.message }, { status: 500 });
      }

      accountId = account.id;
    }

    const appUrl = process.env.APP_URL ?? "https://coconut-app.dev";
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${appUrl}/api/stripe/connect/onboarding-refresh?account_id=${accountId}&scheme=${scheme}`,
      return_url: `${appUrl}/api/stripe/connect/onboarding-return?account_id=${accountId}&scheme=${scheme}`,
      type: "account_onboarding",
    });

    return NextResponse.json({ url: accountLink.url, accountId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[stripe-connect] create-account error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
