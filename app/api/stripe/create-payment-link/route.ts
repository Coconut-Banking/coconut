export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createPayLinkToken, payLinkPublicUrl } from "@/lib/pay-link-token";
import { assertUserCanCreatePayLink, resolvePayLinkAmount } from "@/lib/stripe-pay-link";

/**
 * POST /api/stripe/create-payment-link
 * Creates a signed Coconut pay link (not an immediate Stripe Checkout session).
 * Body: { amount, currency?, groupId, payerMemberId, receiverMemberId }
 */
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    amount: number;
    currency?: string;
    groupId: string;
    payerMemberId: string;
    receiverMemberId: string;
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

  if (!body.groupId || !body.payerMemberId || !body.receiverMemberId) {
    return NextResponse.json({ error: "groupId, payerMemberId, and receiverMemberId required" }, { status: 400 });
  }

  const access = await assertUserCanCreatePayLink(
    userId,
    body.groupId,
    body.payerMemberId,
    body.receiverMemberId,
  );
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const currency = (body.currency ?? "USD").toUpperCase();

  const draftPayload = {
    v: 1 as const,
    groupId: body.groupId,
    payerMemberId: body.payerMemberId,
    receiverMemberId: body.receiverMemberId,
    amount: Math.round(amount * 100) / 100,
    currency,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
    nonce: "",
  };

  const amountResult = await resolvePayLinkAmount(draftPayload);
  if (!amountResult.ok) {
    return NextResponse.json({ error: amountResult.error }, { status: amountResult.status });
  }

  try {
    const token = createPayLinkToken({
      groupId: body.groupId,
      payerMemberId: body.payerMemberId,
      receiverMemberId: body.receiverMemberId,
      amount: amountResult.amount,
      currency,
    });
    const url = payLinkPublicUrl(token);
    return NextResponse.json({ url, token });
  } catch (e) {
    console.error("[create-payment-link]", e);
    return NextResponse.json({ error: "Payment link signing not configured" }, { status: 503 });
  }
}
