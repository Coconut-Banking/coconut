export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getEffectiveUserId } from "@/lib/demo";
import { loadClerkAuth } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { payUrlForStoredToken } from "@/lib/payment-requests";
import { notifyUsers } from "@/lib/push-sender";

const NUDGE_COOLDOWN_MS = 12 * 60 * 60 * 1000;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await loadClerkAuth();
  if (!auth.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const userId = await getEffectiveUserId({ userId: auth.userId });
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const db = getSupabase();

  const { data: bill } = await db
    .from("payment_requests")
    .select("*, receiver:receiver_member_id(user_id), payer:payer_member_id(user_id, display_name)")
    .eq("id", id)
    .maybeSingle();

  if (!bill) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: receiverMember } = await db
    .from("group_members")
    .select("id, user_id")
    .eq("id", bill.receiver_member_id)
    .maybeSingle();

  if (receiverMember?.user_id !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (bill.status !== "pending") {
    return NextResponse.json({ error: "Bill is not pending" }, { status: 400 });
  }

  if (bill.last_nudged_at) {
    const last = new Date(bill.last_nudged_at).getTime();
    if (Date.now() - last < NUDGE_COOLDOWN_MS) {
      return NextResponse.json({ error: "Nudge sent recently — try again later" }, { status: 429 });
    }
  }

  const { data: payerMember } = await db
    .from("group_members")
    .select("user_id, display_name")
    .eq("id", bill.payer_member_id)
    .maybeSingle();

  await db
    .from("payment_requests")
    .update({ last_nudged_at: new Date().toISOString() })
    .eq("id", id);

  const payUrl = payUrlForStoredToken(bill.pay_link_token);
  const label = bill.label ?? "your share";
  const amt = Number(bill.amount).toFixed(2);

  if (payerMember?.user_id) {
    void notifyUsers(
      [payerMember.user_id],
      "Payment reminder",
      `Reminder: you owe $${amt} for ${label}`,
      { type: "bill_nudge", paymentRequestId: id, payUrl },
    );
  }

  return NextResponse.json({ ok: true, payUrl });
}
