export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getEffectiveUserId } from "@/lib/demo";
import { loadClerkAuth } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { payUrlForStoredToken } from "@/lib/payment-requests";

/** GET /api/bills/[id] — detail for payer/receiver (includes itemized receipt when linked). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await loadClerkAuth();
  if (!auth.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const userId = await getEffectiveUserId({ userId: auth.userId });
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const db = getSupabase();

  const { data: bill, error } = await db
    .from("payment_requests")
    .select(
      "id, group_id, receipt_scan_id, payer_member_id, receiver_member_id, amount, currency, label, status, resolution_method, pay_link_token, created_at, paid_at, last_nudged_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !bill) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: memberRows } = await db
    .from("group_members")
    .select("id")
    .eq("user_id", userId);

  const memberIds = (memberRows ?? []).map((m) => m.id);
  const isPayer = memberIds.includes(bill.payer_member_id);
  const isReceiver = memberIds.includes(bill.receiver_member_id);
  if (!isPayer && !isReceiver) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [{ data: group }, { data: members }] = await Promise.all([
    db.from("groups").select("name").eq("id", bill.group_id).maybeSingle(),
    db
      .from("group_members")
      .select("id, display_name")
      .in("id", [bill.payer_member_id, bill.receiver_member_id]),
  ]);

  const payerName =
    members?.find((m) => m.id === bill.payer_member_id)?.display_name ?? "Someone";
  const receiverName =
    members?.find((m) => m.id === bill.receiver_member_id)?.display_name ?? "Someone";

  let receipt: {
    id: string;
    merchantName: string | null;
    subtotal: number;
    tax: number;
    tip: number;
    total: number;
    items: Array<{
      id: string;
      name: string;
      quantity: number;
      unit_price: number;
      total_price: number;
    }>;
  } | null = null;

  if (bill.receipt_scan_id) {
    const { data: scan } = await db
      .from("receipt_scans")
      .select(
        `
        id, merchant_name, subtotal, tax, tip, total,
        receipt_items(id, name, quantity, unit_price, total_price, sort_order)
      `,
      )
      .eq("id", bill.receipt_scan_id)
      .maybeSingle();

    if (scan) {
      const items = (scan.receipt_items ?? []).sort(
        (a: { sort_order: number }, b: { sort_order: number }) => a.sort_order - b.sort_order,
      );
      receipt = {
        id: scan.id,
        merchantName: scan.merchant_name,
        subtotal: Number(scan.subtotal ?? 0),
        tax: Number(scan.tax ?? 0),
        tip: Number(scan.tip ?? 0),
        total: Number(scan.total ?? 0),
        items: items.map(
          (i: {
            id: string;
            name: string;
            quantity: number;
            unit_price: number;
            total_price: number;
          }) => ({
            id: i.id,
            name: i.name,
            quantity: i.quantity,
            unit_price: i.unit_price,
            total_price: i.total_price,
          }),
        ),
      };
    }
  }

  return NextResponse.json({
    id: bill.id,
    groupId: bill.group_id,
    groupName: group?.name ?? "Group",
    label: bill.label ?? "Bill",
    amount: Number(bill.amount),
    currency: bill.currency,
    status: bill.status,
    resolutionMethod: bill.resolution_method,
    payerName,
    receiverName,
    payUrl: payUrlForStoredToken(bill.pay_link_token),
    createdAt: bill.created_at,
    paidAt: bill.paid_at,
    lastNudgedAt: bill.last_nudged_at,
    isPayer,
    isReceiver,
    receiptId: bill.receipt_scan_id,
    receipt,
  });
}
