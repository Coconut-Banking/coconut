export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getUserId } from "@/lib/auth";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> }
) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, memberId } = await params;
  const db = getSupabase();

  const { data: group, error: groupError } = await db.from("groups").select("owner_id").eq("id", id).single();
  if (groupError || !group || group.owner_id !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: member, error: memberError } = await db
    .from("group_members")
    .select("id, user_id")
    .eq("id", memberId)
    .eq("group_id", id)
    .maybeSingle();

  if (memberError) {
    console.error("[members/memberId] lookup:", memberError.message);
    return NextResponse.json({ error: "Operation failed" }, { status: 500 });
  }
  if (!member) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (member.user_id === userId) {
    return NextResponse.json(
      { error: "Cannot remove yourself; use leave group instead" },
      { status: 400 }
    );
  }

  const { error: deleteError } = await db
    .from("group_members")
    .delete()
    .eq("id", memberId)
    .eq("group_id", id);

  if (deleteError) {
    console.error("[members/memberId] delete:", deleteError.message);
    return NextResponse.json({ error: "Operation failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
