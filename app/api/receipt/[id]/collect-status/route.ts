export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { canAccessGroup } from "@/lib/group-access";

/** GET /api/receipt/[id]/collect-status — host monitor for table collection */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: receiptId } = await params;
  const db = getSupabase();

  const { data: receipt } = await db
    .from("receipt_scans")
    .select("id, group_id, merchant_name, status, collect_session_id, clerk_user_id")
    .eq("id", receiptId)
    .eq("clerk_user_id", userId)
    .maybeSingle();

  if (!receipt) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!receipt.collect_session_id) {
    return NextResponse.json({ collecting: false, participants: [] });
  }

  const allowed = await canAccessGroup(userId, receipt.group_id ?? "");
  if (!allowed && receipt.group_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: participants } = await db
    .from("receipt_collect_participants")
    .select("member_id, display_name, status, submitted_at")
    .eq("collect_session_id", receipt.collect_session_id);

  const list = participants ?? [];

  let hostMemberId: string | null = null;
  if (receipt.group_id) {
    const { data: hostMember } = await db
      .from("group_members")
      .select("id")
      .eq("group_id", receipt.group_id)
      .eq("user_id", userId)
      .maybeSingle();
    hostMemberId = hostMember?.id ?? null;
  }

  const guests = hostMemberId
    ? list.filter((p) => p.member_id !== hostMemberId)
    : list;
  const guestsSubmitted = guests.filter((p) => p.status === "submitted").length;

  return NextResponse.json({
    collecting: receipt.status === "collecting",
    receiptStatus: receipt.status,
    merchantName: receipt.merchant_name,
    sessionId: receipt.collect_session_id,
    participants: list,
    submittedCount: guestsSubmitted,
    totalCount: guests.length,
    guestsSubmitted,
    guestCount: guests.length,
    pendingGuests: Math.max(0, guests.length - guestsSubmitted),
  });
}
