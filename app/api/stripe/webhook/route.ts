import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getSupabase } from "@/lib/supabase";
import { getMaxSettlementAllowed } from "@/lib/group-balances";

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

/**
 * POST /api/stripe/webhook
 * Handles Stripe webhooks. On checkout.session.completed with settlement
 * metadata, auto-records the settlement so balances update.
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
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    console.warn("[stripe-webhook] signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const session = event.data.object as Stripe.Checkout.Session;
    const { group_id, payer_member_id, receiver_member_id } = session.metadata ?? {};

    if (group_id && payer_member_id && receiver_member_id && session.payment_status === "paid") {
      const db = getSupabase();

      const { data: existing } = await db
        .from("settlements")
        .select("id")
        .eq("external_reference", session.id)
        .maybeSingle();

      if (existing) return NextResponse.json({ received: true });

      const amountCents = session.amount_total ?? 0;
      const amount = amountCents / 100;

      const { maxAmount, allowed } = await getMaxSettlementAllowed(
        group_id,
        payer_member_id,
        receiver_member_id
      );

      if (allowed && maxAmount > 0) {
        const amountToInsert = Math.min(amount, maxAmount);
        const { error } = await db.from("settlements").insert({
          group_id,
          payer_member_id,
          receiver_member_id,
          amount: Math.round(amountToInsert * 100) / 100,
          method: "stripe",
          status: "completed",
          external_reference: session.id,
        });

        if (error) {
          console.error("[stripe-webhook] settlement insert failed:", error);
        }
      }
    }
  }

  return NextResponse.json({ received: true });
}
