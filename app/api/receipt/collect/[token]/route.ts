export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { verifyCollectLinkToken } from "@/lib/collect-link-token";
import { payLinkPublicUrl } from "@/lib/pay-link-token";
import { getSupabase } from "@/lib/supabase";

/** GET /api/receipt/collect/[token] — public lobby (members + receipt items). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params;
  const verified = verifyCollectLinkToken(decodeURIComponent(raw));
  if (!verified.valid) {
    const status = verified.reason === "expired" ? 410 : 400;
    return NextResponse.json({ error: "Invalid or expired link" }, { status });
  }

  const db = getSupabase();
  const { data: session } = await db
    .from("collect_sessions")
    .select("id, group_id, status, payload, expires_at")
    .eq("id", verified.payload.sessionId)
    .maybeSingle();

  if (!session) {
    return NextResponse.json({ error: "Collection closed" }, { status: 404 });
  }

  const receiptScanId = (session.payload as { receiptScanId?: string })?.receiptScanId;
  if (!receiptScanId) {
    return NextResponse.json({ error: "Invalid session" }, { status: 400 });
  }

  const [{ data: participants }, { data: receipt }] = await Promise.all([
    db
      .from("receipt_collect_participants")
      .select("member_id, display_name, status, submitted_at")
      .eq("collect_session_id", session.id),
    db
      .from("receipt_scans")
      .select(`
        id, merchant_name, subtotal, tax, tip, total, status,
        receipt_items(id, name, quantity, unit_price, total_price, sort_order)
      `)
      .eq("id", receiptScanId)
      .maybeSingle(),
  ]);

  if (!receipt) return NextResponse.json({ error: "Receipt not found" }, { status: 404 });

  const items = (receipt.receipt_items ?? []).sort(
    (a: { sort_order: number }, b: { sort_order: number }) => a.sort_order - b.sort_order,
  );

  const sessionClosed = session.status !== "open";
  const readyToPay = receipt.status === "ready_to_pay" || sessionClosed;

  if (readyToPay) {
    const { data: paymentRows } = await db
      .from("payment_requests")
      .select("payer_member_id, amount, currency, status, pay_link_token")
      .eq("collect_session_id", session.id);

    const memberNames = new Map(
      (participants ?? []).map((p) => [p.member_id, p.display_name]),
    );

    const shares = (paymentRows ?? []).map((row) => ({
      memberId: row.payer_member_id,
      displayName: memberNames.get(row.payer_member_id) ?? "Guest",
      amount: Number(row.amount),
      currency: row.currency ?? "USD",
      status: row.status,
      payUrl: row.pay_link_token ? payLinkPublicUrl(row.pay_link_token) : null,
    }));

    return NextResponse.json({
      phase: "pay",
      sessionId: session.id,
      groupId: session.group_id,
      merchantName: receipt.merchant_name,
      participants: participants ?? [],
      shares,
    });
  }

  if (sessionClosed) {
    return NextResponse.json({ error: "Collection closed" }, { status: 404 });
  }

  return NextResponse.json({
    phase: "collect",
    sessionId: session.id,
    groupId: session.group_id,
    merchantName: receipt.merchant_name,
    participants: participants ?? [],
    items,
  });
}
