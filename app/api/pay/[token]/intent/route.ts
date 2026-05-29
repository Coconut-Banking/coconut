export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { verifyPayLinkToken } from "@/lib/pay-link-token";
import { createPayLinkPaymentIntent, PayLinkCheckoutError } from "@/lib/stripe-pay-link";
import { getStripePublishableKey } from "@/lib/stripe-connect-account";
import { getSupabase } from "@/lib/supabase";

type RouteContext = { params: Promise<{ token: string }> };

/**
 * POST /api/pay/[token]/intent
 * Public — PaymentIntent for in-page Apple Pay / card (no Stripe Checkout redirect).
 */
export async function POST(_req: NextRequest, context: RouteContext) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }

  const publishableKey = getStripePublishableKey();
  if (!publishableKey) {
    return NextResponse.json({ error: "Stripe publishable key not configured" }, { status: 503 });
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
    const intent = await createPayLinkPaymentIntent(stripe, verified.payload, {
      paymentRequestId: billRow?.id,
    });
    return NextResponse.json({
      clientSecret: intent.clientSecret,
      paymentIntentId: intent.paymentIntentId,
      publishableKey,
    });
  } catch (e) {
    if (e instanceof PayLinkCheckoutError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    const msg = e instanceof Stripe.errors.StripeError ? e.message : "Payment failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
