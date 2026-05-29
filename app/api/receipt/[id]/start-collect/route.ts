export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { canAccessGroup } from "@/lib/group-access";
import { randomUUID } from "crypto";
import { currentUser } from "@clerk/nextjs/server";
import { createCollectLinkToken, collectPublicUrl } from "@/lib/collect-link-token";

const COLLECT_HOURS = 24;

/**
 * POST /api/receipt/[id]/start-collect
 * Opens a table collection session; returns QR URL for guests.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: receiptId } = await params;
  let body: { groupId?: string; autoGroup?: boolean; groupName?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* optional body */
  }

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

  let groupId = body.groupId ?? receipt.group_id;

  if (!groupId && body.autoGroup) {
    const groupName =
      body.groupName?.trim().slice(0, 100) ||
      receipt.merchant_name?.trim().slice(0, 100) ||
      "Receipt split";
    const inviteToken = `inv_${randomUUID().replace(/-/g, "")}`;
    const ownerUser = await currentUser();
    const ownerEmail = ownerUser?.primaryEmailAddress?.emailAddress ?? null;

    const { data: group, error: groupErr } = await db
      .from("groups")
      .insert({
        owner_id: userId,
        name: groupName,
        group_type: "other",
        invite_token: inviteToken,
      })
      .select("id")
      .single();

    if (groupErr || !group) {
      console.error("[start-collect] auto group:", groupErr);
      return NextResponse.json({ error: "Could not create bill" }, { status: 500 });
    }

    const { error: memberErr } = await db.from("group_members").insert({
      group_id: group.id,
      user_id: userId,
      display_name: "You",
      email: ownerEmail,
    });

    if (memberErr) {
      console.error("[start-collect] host member:", memberErr);
      return NextResponse.json({ error: "Could not create bill" }, { status: 500 });
    }

    groupId = group.id;
  }

  if (!groupId) {
    return NextResponse.json({ error: "groupId required" }, { status: 400 });
  }

  if (!receipt.group_id) {
    await db.from("receipt_scans").update({ group_id: groupId }).eq("id", receiptId);
  }

  const allowed = await canAccessGroup(userId, groupId);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const expiresAt = new Date(Date.now() + COLLECT_HOURS * 60 * 60 * 1000).toISOString();

  const { data: session, error: sessionErr } = await db
    .from("collect_sessions")
    .insert({
      group_id: groupId,
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

  // Guests are added only when they join via the link (not the host roster).

  await db
    .from("receipt_scans")
    .update({ status: "collecting", collect_session_id: session.id })
    .eq("id", receiptId);

  const token = createCollectLinkToken(session.id);
  const collectUrl = collectPublicUrl(token, "receipt/collect");

  return NextResponse.json({
    sessionId: session.id,
    groupId,
    token,
    collectUrl,
    expiresAt,
  });
}
