export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { canAccessGroup } from "@/lib/group-access";
import { createCollectLinkToken, collectPublicUrl } from "@/lib/collect-link-token";

const COLLECT_HOURS = 24;

/**
 * POST /api/receipt/[id]/start-collect
 * Opens a table collection session; returns QR URL for guests.
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
    .select("id, group_id, merchant_name, status, clerk_user_id")
    .eq("id", receiptId)
    .eq("clerk_user_id", userId)
    .maybeSingle();

  if (receiptErr || !receipt) {
    return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  }
  if (!receipt.group_id) {
    return NextResponse.json({ error: "Assign this receipt to a group first" }, { status: 400 });
  }

  const allowed = await canAccessGroup(userId, receipt.group_id);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const expiresAt = new Date(Date.now() + COLLECT_HOURS * 60 * 60 * 1000).toISOString();

  const { data: session, error: sessionErr } = await db
    .from("collect_sessions")
    .insert({
      group_id: receipt.group_id,
      host_clerk_user_id: userId,
      session_type: "receipt",
      payload: { receiptScanId: receiptId },
      status: "open",
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (sessionErr || !session) {
    console.error("[start-collect] session:", sessionErr);
    return NextResponse.json({ error: "Could not start collection" }, { status: 500 });
  }

  const { data: members } = await db
    .from("group_members")
    .select("id, display_name")
    .eq("group_id", receipt.group_id);

  if (members?.length) {
    await db.from("receipt_collect_participants").upsert(
      members.map((m) => ({
        collect_session_id: session.id,
        member_id: m.id,
        display_name: m.display_name ?? "Guest",
        status: "invited",
      })),
      { onConflict: "collect_session_id,member_id" },
    );
  }

  await db
    .from("receipt_scans")
    .update({ status: "collecting", collect_session_id: session.id })
    .eq("id", receiptId);

  const token = createCollectLinkToken(session.id);
  const collectUrl = collectPublicUrl(token, "receipt/collect");

  return NextResponse.json({
    sessionId: session.id,
    token,
    collectUrl,
    expiresAt,
  });
}
