export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { verifyCollectLinkToken } from "@/lib/collect-link-token";
import { getSupabase } from "@/lib/supabase";
import { createPaymentRequestWithPayLink } from "@/lib/payment-requests";

/**
 * POST /api/collect/[token]/claim
 * Public — pay collect: pick name → personal pay link.
 * Body: { memberId }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params;
  const verified = verifyCollectLinkToken(decodeURIComponent(raw));
  if (!verified.valid) {
    const status = verified.reason === "expired" ? 410 : 400;
    return NextResponse.json({ error: "Invalid or expired link" }, { status });
  }

  let body: { memberId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (!body.memberId) return NextResponse.json({ error: "memberId required" }, { status: 400 });

  const db = getSupabase();
  const { data: session } = await db
    .from("collect_sessions")
    .select("id, group_id, session_type, status, payload")
    .eq("id", verified.payload.sessionId)
    .maybeSingle();

  if (!session || session.status !== "open" || session.session_type !== "pay") {
    return NextResponse.json({ error: "Session not available" }, { status: 404 });
  }

  const payload = session.payload as {
    amount?: number;
    currency?: string;
    receiverMemberId?: string;
    label?: string;
  };

  const amount = Number(payload.amount);
  const receiverMemberId = payload.receiverMemberId;
  if (!receiverMemberId || !Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Invalid session" }, { status: 400 });
  }

  const { data: member } = await db
    .from("group_members")
    .select("id, display_name")
    .eq("id", body.memberId)
    .eq("group_id", session.group_id)
    .maybeSingle();

  if (!member) return NextResponse.json({ error: "Member not in group" }, { status: 400 });

  const created = await createPaymentRequestWithPayLink({
    groupId: session.group_id,
    payerMemberId: member.id,
    receiverMemberId,
    amount,
    currency: payload.currency ?? "USD",
    label: payload.label ?? `Payment to ${member.display_name ?? "host"}`,
    collectSessionId: session.id,
  });

  if (!created) {
    return NextResponse.json({ error: "Could not create payment link" }, { status: 500 });
  }

  return NextResponse.json({
    payUrl: created.payUrl,
    token: created.token,
    paymentRequestId: created.id,
  });
}
