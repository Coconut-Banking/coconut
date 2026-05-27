export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import Stripe from "stripe";
import { canAccessGroup } from "@/lib/group-access";
import { recordStripeSettlement } from "@/lib/stripe-settlement-record";

/**
 * POST /api/stripe/terminal/record-settlement
 * Idempotently records a Terminal payment as a stripe settlement (same as webhook).
 * Mobile calls this right after Tap to Pay succeeds for instant UI; webhook is a backup.
 */
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }

  let body: { paymentIntentId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const paymentIntentId =
    typeof body.paymentIntentId === "string" ? body.paymentIntentId.trim() : "";
  if (!paymentIntentId) {
    return NextResponse.json({ error: "paymentIntentId required" }, { status: 400 });
  }

  const stripe = new Stripe(key);
  let pi: Stripe.PaymentIntent;
  try {
    pi = await stripe.paymentIntents.retrieve(paymentIntentId);
  } catch {
    return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  }

  if (pi.status !== "succeeded") {
    return NextResponse.json({ error: "Payment not completed" }, { status: 400 });
  }

  if (pi.metadata?.source !== "terminal") {
    return NextResponse.json({ error: "Not a terminal payment" }, { status: 400 });
  }

  const { group_id, payer_member_id, receiver_member_id } = pi.metadata ?? {};
  if (!group_id || !payer_member_id || !receiver_member_id) {
    return NextResponse.json({ error: "Missing settlement metadata" }, { status: 400 });
  }

  const allowed = await canAccessGroup(userId, group_id);
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const amountCents = pi.amount_received ?? pi.amount ?? 0;
  const currency = (pi.currency ?? "usd").toUpperCase();
  const result = await recordStripeSettlement({
    groupId: group_id,
    payerMemberId: payer_member_id,
    receiverMemberId: receiver_member_id,
    amount: amountCents / 100,
    currency,
    externalReference: pi.id,
    source: "terminal",
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    amountRecorded: result.amountRecorded,
    alreadyRecorded: result.amountRecorded === 0,
  });
}
