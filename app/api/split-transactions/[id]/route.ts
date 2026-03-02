import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { canAccessGroup } from "@/lib/group-access";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const db = getSupabase();

  const { data: split } = await db
    .from("split_transactions")
    .select("id, group_id")
    .eq("id", id)
    .single();

  if (!split) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const allowed = await canAccessGroup(userId, split.group_id);
  if (!allowed) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.from("split_transactions").delete().eq("id", id);

  const { count } = await db
    .from("split_transactions")
    .select("id", { count: "exact", head: true })
    .eq("group_id", split.group_id);

  if (count === 0) {
    await db.from("settlements").delete().eq("group_id", split.group_id);
  }

  return NextResponse.json({ ok: true });
}
