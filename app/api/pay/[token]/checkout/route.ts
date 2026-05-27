export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { verifyPayLinkToken } from "@/lib/pay-link-token";
import { createPayLinkCheckoutSession, PayLinkCheckoutError } from "@/lib/stripe-pay-link";
import { getSupabase } from "@/lib/supabase";

type RouteContext = { params: Promise<{ token: string }> };

/**
 * POST /api/pay/[token]/checkout
 * Public — creates a Stripe Checkout session (card / Apple Pay in Safari).
 */
export async function POST(_req: NextRequest, context: RouteContext) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }

  const { token: rawToken } = await context.params;
  const token = decodeURIComponent(rawToken);
  const verified = verifyPayLinkToken(token);

  if (!verified.valid) {
    const status = verified.reason === "expired" ? 410 : 400;
    return NextResponse.json({ error: "Invalid or expired payment link" }, { status });
  }

  const db = getSupabase();
  const { data: billRow } = await db
    .from("payment_requests")
    .select("id")
    .eq("pay_link_token", token)
    .eq("status", "pending")
    .maybeSingle();

  const stripe = new Stripe(key);

  try {
    const session = await createPayLinkCheckoutSession(stripe, verified.payload, token, {
      paymentRequestId: billRow?.id,
    });
    return NextResponse.json({ url: session.url, sessionId: session.sessionId });
  } catch (e) {
    if (e instanceof PayLinkCheckoutError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    const msg = e instanceof Stripe.errors.StripeError ? e.message : "Checkout failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
