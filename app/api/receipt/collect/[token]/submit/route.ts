export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { verifyCollectLinkToken } from "@/lib/collect-link-token";
import { getSupabase } from "@/lib/supabase";

type AssignmentInput = {
  itemId: string;
  assignees: Array<{ name: string; memberId?: string | null }>;
};

/**
 * POST /api/receipt/collect/[token]/submit
 * Public — guest submits item assignments for their member row.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params;
  const verified = verifyCollectLinkToken(decodeURIComponent(raw));
  if (!verified.valid) {
    const status = verified.reason === "expired" ? 410 : 400;
    return NextResponse.json({ error: "Invalid or expired link" }, { status });
  }

  let body: { memberId?: string; assignments?: AssignmentInput[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const memberId = body.memberId;
  if (!memberId) return NextResponse.json({ error: "memberId required" }, { status: 400 });
  if (!Array.isArray(body.assignments)) {
    return NextResponse.json({ error: "assignments[] required" }, { status: 400 });
  }

  const db = getSupabase();
  const { data: session } = await db
    .from("collect_sessions")
    .select("id, group_id, status, payload")
    .eq("id", verified.payload.sessionId)
    .maybeSingle();

  if (!session || session.status !== "open") {
    return NextResponse.json({ error: "Collection closed" }, { status: 404 });
  }

  const receiptScanId = (session.payload as { receiptScanId?: string })?.receiptScanId;
  if (!receiptScanId) return NextResponse.json({ error: "Invalid session" }, { status: 400 });

  const { data: participant } = await db
    .from("receipt_collect_participants")
    .select("member_id, status")
    .eq("collect_session_id", session.id)
    .eq("member_id", memberId)
    .maybeSingle();

  if (!participant) return NextResponse.json({ error: "Member not in this bill" }, { status: 400 });
  if (participant.status === "submitted") {
    return NextResponse.json({ error: "Already submitted" }, { status: 409 });
  }

  const { data: member } = await db
    .from("group_members")
    .select("id, display_name")
    .eq("id", memberId)
    .eq("group_id", session.group_id)
    .maybeSingle();

  if (!member) return NextResponse.json({ error: "Invalid member" }, { status: 400 });

  const { data: receiptItems } = await db
    .from("receipt_items")
    .select("id")
    .eq("receipt_id", receiptScanId);

  const validIds = new Set((receiptItems ?? []).map((i) => i.id));

  const displayName = member.display_name ?? "Guest";

  for (const a of body.assignments) {
    if (!validIds.has(a.itemId)) continue;
    const mine = a.assignees.some((x) => x.memberId === memberId || x.name === displayName);
    await db
      .from("receipt_assignments")
      .delete()
      .eq("receipt_item_id", a.itemId)
      .eq("member_id", memberId);
    if (mine) {
      await db.from("receipt_assignments").insert({
        receipt_item_id: a.itemId,
        assignee_name: displayName,
        member_id: memberId,
      });
    }
  }

  await db
    .from("receipt_collect_participants")
    .update({ status: "submitted", submitted_at: new Date().toISOString() })
    .eq("collect_session_id", session.id)
    .eq("member_id", memberId);

  return NextResponse.json({ ok: true });
}
