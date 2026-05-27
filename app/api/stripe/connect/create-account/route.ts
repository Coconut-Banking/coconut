export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import Stripe from "stripe";
import { getSupabase } from "@/lib/supabase";
import { ensureStripeConnectAccount } from "@/lib/stripe-connect-account";

/**
 * POST /api/stripe/connect/create-account
 * Creates a Stripe Express connected account for the current user.
 * Default: returns an Account Link URL for hosted onboarding.
 * Body `{ embedded: true }`: skips Account Link (use account-session + embedded UI).
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
  const embedded = (body as { embedded?: boolean }).embedded === true;

  try {
    const stripe = new Stripe(key);
    const db = getSupabase();
    const user = await currentUser();

    const { accountId, created } = await ensureStripeConnectAccount({
      stripe,
      db,
      userId,
      email: user?.emailAddresses?.[0]?.emailAddress ?? undefined,
      firstName: user?.firstName ?? undefined,
      lastName: user?.lastName ?? undefined,
      phone: user?.phoneNumbers?.[0]?.phoneNumber ?? undefined,
    });

    if (embedded) {
      return NextResponse.json({ accountId, created, embedded: true });
    }

    const appUrl = process.env.APP_URL ?? "https://coconut-app.dev";
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${appUrl}/api/stripe/connect/onboarding-refresh?account_id=${accountId}&scheme=${scheme}`,
      return_url: `${appUrl}/api/stripe/connect/onboarding-return?account_id=${accountId}&scheme=${scheme}`,
      type: "account_onboarding",
    });

    return NextResponse.json({ url: accountLink.url, accountId, created });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[stripe-connect] create-account error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
