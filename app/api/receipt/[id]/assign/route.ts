import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";

// Save item → person assignments
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { assignments } = body;

  if (!Array.isArray(assignments)) {
    return NextResponse.json(
      { error: "assignments[] required" },
      { status: 400 }
    );
  }

  const db = getSupabase();

  // Verify ownership
  const { data: receipt, error: receiptError } = await db
    .from("receipt_scans")
    .select("id")
    .eq("id", id)
    .eq("clerk_user_id", userId)
    .single();

  if (receiptError || !receipt) {
    return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  }

  // Get item ids for this receipt
  const { data: receiptItems } = await db
    .from("receipt_items")
    .select("id")
    .eq("receipt_id", id);

  const validItemIds = new Set((receiptItems ?? []).map((i) => i.id));

  // Clear existing assignments for these items
  if (receiptItems && receiptItems.length > 0) {
    await db
      .from("receipt_assignments")
      .delete()
      .in(
        "receipt_item_id",
        receiptItems.map((i) => i.id)
      );
  }

  // Insert new assignments
  const rows: Array<{
    receipt_item_id: string;
    assignee_name: string;
    member_id: string | null;
  }> = [];

  for (const a of assignments) {
    if (!validItemIds.has(a.itemId)) continue;
    for (const assignee of a.assignees) {
      rows.push({
        receipt_item_id: a.itemId,
        assignee_name: assignee.name,
        member_id: assignee.memberId ?? null,
      });
    }
  }

  if (rows.length > 0) {
    await db.from("receipt_assignments").insert(rows);
  }

  // Update status
  await db.from("receipt_scans").update({ status: "assigned" }).eq("id", id);

  return NextResponse.json({ ok: true });
}
