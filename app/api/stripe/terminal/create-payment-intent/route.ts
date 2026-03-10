import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import Stripe from "stripe";
import { DEFAULT_CURRENCY } from "@/lib/currency";
import { canAccessGroup } from "@/lib/group-access";
import { getSupabase } from "@/lib/supabase";

/**
 * POST /api/stripe/terminal/create-payment-intent
 * Creates a PaymentIntent for Stripe Terminal (Tap to Pay).
 * Body: { amount: number, groupId?, payerMemberId?, receiverMemberId? }
 * When settlement metadata is provided, the webhook will record the settlement on success.
 */
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }

  let body: {
    amount: number;
    groupId?: string;
    payerMemberId?: string;
    receiverMemberId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Valid amount required" }, { status: 400 });
  }

  const amountCents = Math.round(amount * 100);
  const stripe = new Stripe(key);

  const metadata: Record<string, string> = {};
  if (body.groupId && body.payerMemberId && body.receiverMemberId) {
    const allowed = await canAccessGroup(userId, body.groupId);
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const db = getSupabase();
    const { data: groupMembers } = await db
      .from("group_members")
      .select("id")
      .eq("group_id", body.groupId)
      .in("id", [body.payerMemberId, body.receiverMemberId]);

    if (!groupMembers || groupMembers.length < 2) {
      return NextResponse.json(
        { error: "Payer or receiver not found in group" },
        { status: 400 }
      );
    }

    metadata.group_id = body.groupId;
    metadata.payer_member_id = body.payerMemberId;
    metadata.receiver_member_id = body.receiverMemberId;
    metadata.source = "terminal";
  }

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: DEFAULT_CURRENCY,
      metadata,
      payment_method_types: ["card_present"],
    });
    return NextResponse.json({ clientSecret: paymentIntent.client_secret });
  } catch (e) {
    console.error("[terminal] create payment intent error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to create payment intent" },
      { status: 500 }
    );
  }
}
