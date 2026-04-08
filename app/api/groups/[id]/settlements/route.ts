export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { revalidateTag } from "next/cache";
import { getSupabase } from "@/lib/supabase";
import { CACHE_TAGS } from "@/lib/cached-queries";

/**
 * DELETE /api/groups/[id]/settlements
 * Clears all settlements for a group. Use when balances are corrupted from duplicate "Mark paid" clicks.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const db = getSupabase();

  const { data: group, error: groupError } = await db.from("groups").select("owner_id").eq("id", id).single();
  if (groupError || !group || group.owner_id !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { error } = await db.from("settlements").delete().eq("group_id", id);

  if (error) {
    if (process.env.NODE_ENV === 'development') console.error("[settlements] delete:", error.message);
    return NextResponse.json({ error: "Operation failed" }, { status: 500 });
  }

  revalidateTag(CACHE_TAGS.splitTransactions(userId), "max");
  return NextResponse.json({ ok: true });
}
