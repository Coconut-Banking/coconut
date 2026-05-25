export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { verifyPayLinkToken } from "@/lib/pay-link-token";
import { getPayLinkPreview, resolvePayLinkAmount } from "@/lib/stripe-pay-link";

type RouteContext = { params: Promise<{ token: string }> };

/**
 * GET /api/pay/[token]
 * Public preview for a payment link (no auth required).
 */
export async function GET(_req: NextRequest, context: RouteContext) {
  const { token: rawToken } = await context.params;
  const token = decodeURIComponent(rawToken);
  const verified = verifyPayLinkToken(token);

  if (!verified.valid) {
    const status = verified.reason === "expired" ? 410 : 400;
    return NextResponse.json(
      { error: "Invalid or expired payment link", reason: verified.reason },
      { status },
    );
  }

  const preview = await getPayLinkPreview(verified.payload);
  const amountResult = await resolvePayLinkAmount(verified.payload);

  return NextResponse.json({
    ...preview,
    amount: amountResult.ok ? amountResult.amount : preview.amount,
    payable: amountResult.ok,
    notPayableReason: amountResult.ok ? null : amountResult.error,
  });
}
