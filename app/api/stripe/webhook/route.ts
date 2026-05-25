import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getSupabase } from "@/lib/supabase";
import { recordStripeSettlement } from "@/lib/stripe-settlement-record";

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const webhookSecretThin = process.env.STRIPE_WEBHOOK_SECRET_THIN;

/**
 * POST /api/stripe/webhook
 * Handles Stripe webhooks for Terminal and Connect events.
 */
export async function POST(req: NextRequest) {
  if (!stripe || !webhookSecret) {
    return NextResponse.json({ error: "Stripe webhook not configured" }, { status: 503 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  let body: string;
  try {
    body = await req.text();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    // Try primary (snapshot) secret first, then thin payload secret
    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret!);
    } catch {
      if (webhookSecretThin) {
        event = stripe.webhooks.constructEvent(body, signature, webhookSecretThin);
      } else {
        throw new Error("Signature verification failed with primary secret");
      }
    }
  } catch (err) {
    console.warn("[stripe-webhook] signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  async function recordFromPaymentIntent(
    pi: Stripe.PaymentIntent,
    source: "terminal" | "payment_link",
  ): Promise<NextResponse | null> {
    const { group_id, payer_member_id, receiver_member_id } = pi.metadata ?? {};
    if (!group_id || !payer_member_id || !receiver_member_id) return null;

    const amountCents = pi.amount_received ?? pi.amount ?? 0;
    const currency = (pi.currency ?? "usd").toUpperCase();
    const result = await recordStripeSettlement({
      groupId: group_id,
      payerMemberId: payer_member_id,
      receiverMemberId: receiver_member_id,
      amount: amountCents / 100,
      currency,
      externalReference: pi.id,
      source,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return null;
  }

  if (event.type === "payment_intent.succeeded") {
    const pi = event.data.object as Stripe.PaymentIntent;
    const source = pi.metadata?.source;
    if (source === "terminal" || source === "payment_link") {
      const errRes = await recordFromPaymentIntent(pi, source);
      if (errRes) return errRes;
    }
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.metadata?.source === "payment_link" && session.payment_intent) {
      const piId =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent.id;
      try {
        const pi = await stripe.paymentIntents.retrieve(piId);
        const errRes = await recordFromPaymentIntent(pi, "payment_link");
        if (errRes) return errRes;
      } catch (e) {
        console.error("[stripe-webhook] checkout.session.completed PI retrieve failed:", e);
        return NextResponse.json({ error: "Could not record settlement" }, { status: 500 });
      }
    }
  }

  if (event.type === "account.updated") {
    const account = event.data.object as Stripe.Account;
    const db = getSupabase();

    // charges_enabled is sufficient for routing payments — payouts_enabled may stay false
    // in test mode (no real bank) but funds still route correctly to the connected account.
    const { error } = await db
      .from("stripe_connected_accounts")
      .update({
        onboarding_complete: account.charges_enabled ?? false,
        charges_enabled: account.charges_enabled ?? false,
        payouts_enabled: account.payouts_enabled ?? false,
      })
      .eq("stripe_account_id", account.id);

    if (error) {
      console.error("[stripe-webhook] connect account update failed:", error);
    } else {
      console.log("[stripe-webhook] connect account updated", {
        accountId: account.id,
        charges_enabled: account.charges_enabled,
        payouts_enabled: account.payouts_enabled,
      });
    }
  }

  return NextResponse.json({ received: true });
}
