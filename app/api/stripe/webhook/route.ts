import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getSupabase } from "@/lib/supabase";
import { getMaxSettlementAllowed } from "@/lib/group-balances";

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

  // Terminal Tap to Pay: PaymentIntent succeeded with settlement metadata
  if (event.type === "payment_intent.succeeded") {
    const pi = event.data.object as Stripe.PaymentIntent;
    const { group_id, payer_member_id, receiver_member_id, source } = pi.metadata ?? {};

    if (source === "terminal" && group_id && payer_member_id && receiver_member_id) {
      const db = getSupabase();

      const { data: existing } = await db
        .from("settlements")
        .select("id")
        .eq("external_reference", pi.id)
        .maybeSingle();

      if (existing) return NextResponse.json({ received: true });

      const amountCents = pi.amount_received ?? pi.amount ?? 0;
      const amount = amountCents / 100;

      const piCurrency = (pi.currency ?? pi.metadata?.original_currency ?? "usd").toUpperCase();

      const { maxAmount, allowed, reason } = await getMaxSettlementAllowed(
        group_id,
        payer_member_id,
        receiver_member_id,
        piCurrency
      );

      if (!allowed || maxAmount <= 0) {
        console.error("[stripe-webhook] terminal settlement not allowed — returning 500 for retry:", { allowed, maxAmount, reason });
        return NextResponse.json({ error: "Settlement validation failed" }, { status: 500 });
      } else {
        const amountToInsert = Math.min(amount, maxAmount);
        const { error } = await db.from("settlements").insert({
          group_id,
          payer_member_id,
          receiver_member_id,
          amount: Math.round(amountToInsert * 100) / 100,
          method: "stripe",
          status: "completed",
          external_reference: pi.id,
          iso_currency_code: piCurrency,
        });

        if (error) {
          console.error("[stripe-webhook] terminal settlement insert failed:", error);
          return NextResponse.json({ error: "DB insert failed" }, { status: 500 });
        } else {
          console.log("[stripe-webhook] terminal settlement recorded", { group_id, amount: amountToInsert });
        }
      }
    }
  }

  // Stripe Connect: update onboarding status when account details change
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
