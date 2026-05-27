export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { revalidateTag } from "next/cache";
import { getSupabase } from "@/lib/supabase";
import { canAccessGroup } from "@/lib/group-access";
import { CACHE_TAGS } from "@/lib/cached-queries";
import {
  buildMemberNameMap,
  resolveAssignmentMemberId,
} from "@/lib/receipt-finish-members";
import { createPaymentRequestWithPayLink } from "@/lib/payment-requests";
import { notifyUsers } from "@/lib/push-sender";

/**
 * POST /api/receipt/[id]/close-collect
 * Finalizes assignments, posts group ledger split, creates payment_requests + pay links.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: receiptId } = await params;
  const db = getSupabase();

  const { data: receipt, error: receiptErr } = await db
    .from("receipt_scans")
    .select(`
      id, group_id, merchant_name, subtotal, tax, tip, total, status, collect_session_id,
      receipt_items(
        id, total_price,
        receipt_assignments(assignee_name, member_id)
      )
    `)
    .eq("id", receiptId)
    .eq("clerk_user_id", userId)
    .maybeSingle();

  if (receiptErr || !receipt) {
    return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  }
  if (!receipt.group_id) {
    return NextResponse.json({ error: "No group on receipt" }, { status: 400 });
  }
  if (receipt.status !== "collecting") {
    return NextResponse.json({ error: "Receipt is not in collection mode" }, { status: 400 });
  }

  const groupId = receipt.group_id;
  const allowed = await canAccessGroup(userId, groupId);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data: members } = await db
    .from("group_members")
    .select("id, display_name, user_id, email")
    .eq("group_id", groupId);

  if (!members?.length) {
    return NextResponse.json({ error: "No members in group" }, { status: 400 });
  }

  const memberByName = buildMemberNameMap(members);
  const memberIdsInGroup = new Set(members.map((m) => m.id));
  const payerMember = members.find((m) => m.user_id === userId);
  if (!payerMember) {
    return NextResponse.json({ error: "You are not a member of this group" }, { status: 400 });
  }

  const subtotal = receipt.subtotal || 0;
  const tax = receipt.tax || 0;
  const tip = receipt.tip || 0;
  const extraPercentage = subtotal > 0 ? (tax + tip) / subtotal : 0;

  const sharesByMember = new Map<string, number>();

  for (const item of receipt.receipt_items ?? []) {
    const itemPrice = item.total_price || 0;
    const itemWithExtra = itemPrice * (1 + extraPercentage);
    const assignments = item.receipt_assignments ?? [];
    if (assignments.length === 0) continue;

    const shareAmount = itemWithExtra / assignments.length;
    for (const assignment of assignments) {
      const memberId = resolveAssignmentMemberId(assignment, memberByName, memberIdsInGroup);
      if (!memberId) continue;
      sharesByMember.set(memberId, (sharesByMember.get(memberId) ?? 0) + shareAmount);
    }
  }

  if (sharesByMember.size === 0) {
    return NextResponse.json({ error: "No items assigned yet" }, { status: 400 });
  }

  const merchantName = receipt.merchant_name || "Receipt";
  const sharesPayload = Array.from(sharesByMember.entries()).map(([memberId, amount]) => ({
    memberId,
    amount: Math.round(amount * 100) / 100,
  }));

  const { data: rpcResult, error: rpcErr } = await db.rpc("finish_receipt_split", {
    p_clerk_user_id: userId,
    p_group_id: groupId,
    p_payer_member_id: payerMember.id,
    p_merchant_name: merchantName,
    p_total: receipt.total || 0,
    p_currency: "USD",
    p_shares: sharesPayload,
  });

  if (rpcErr) {
    console.error("[close-collect] RPC:", rpcErr.message);
    return NextResponse.json({ error: rpcErr.message ?? "Failed to post split" }, { status: 500 });
  }

  const result = rpcResult as { error?: string };
  if (result?.error) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  const bills: Array<{ id: string; payerMemberId: string; amount: number; payUrl: string }> = [];

  for (const [memberId, amount] of sharesByMember) {
    if (memberId === payerMember.id || amount < 0.01) continue;
    const rounded = Math.round(amount * 100) / 100;
    const created = await createPaymentRequestWithPayLink({
      groupId,
      payerMemberId: memberId,
      receiverMemberId: payerMember.id,
      amount: rounded,
      label: merchantName,
      receiptScanId: receiptId,
      collectSessionId: receipt.collect_session_id ?? undefined,
    });
    if (!created) continue;
    bills.push({ id: created.id, payerMemberId: memberId, amount: rounded, payUrl: created.payUrl });

    const payer = members.find((m) => m.id === memberId);
    if (payer?.user_id) {
      void notifyUsers(
        [payer.user_id],
        "Your share is ready",
        `You owe $${rounded.toFixed(2)} for ${merchantName}`,
        { type: "bill_ready", paymentRequestId: created.id },
      );
    }
  }

  await Promise.all([
    db
      .from("receipt_scans")
      .update({ status: "ready_to_pay" })
      .eq("id", receiptId),
    receipt.collect_session_id
      ? db
          .from("collect_sessions")
          .update({ status: "closed" })
          .eq("id", receipt.collect_session_id)
      : Promise.resolve(),
  ]);

  revalidateTag(CACHE_TAGS.splitTransactions(userId), "max");

  return NextResponse.json({ ok: true, billsCreated: bills.length, bills });
}
