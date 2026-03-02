import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import Stripe from "stripe";

/**
 * POST /api/stripe/create-payment-link
 * Creates a Stripe Checkout session for requesting payment. Returns URL for the payer to complete payment.
 * Body: { amount, description?, recipientName?, groupId?, payerMemberId?, receiverMemberId? }
 * When groupId/payer/receiver are passed, the webhook will auto-record the settlement on payment.
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
    description?: string;
    recipientName?: string;
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
  const description = (body.description ?? body.recipientName ?? "Payment request").toString();

  const stripe = new Stripe(key);

  const metadata: Record<string, string> = {};
  if (body.groupId && body.payerMemberId && body.receiverMemberId) {
    metadata.group_id = body.groupId;
    metadata.payer_member_id = body.payerMemberId;
    metadata.receiver_member_id = body.receiverMemberId;
  }

  let baseUrl = process.env.APP_URL || req.nextUrl.origin;
  if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
    baseUrl = `https://${baseUrl}`;
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      metadata,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `Payment request${description ? `: ${description}` : ""}`,
              description: body.recipientName ? `Requested from ${body.recipientName}` : undefined,
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      success_url: `${baseUrl}/app/shared?stripe=success`,
      cancel_url: `${baseUrl}/app/shared?stripe=cancel`,
    });

    const url = session.url;
    if (!url) {
      return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 });
    }

    return NextResponse.json({ url });
  } catch (e) {
    console.error("Stripe error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Stripe request failed" },
      { status: 500 }
    );
  }
}
