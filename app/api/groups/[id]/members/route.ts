import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getUserId } from "@/lib/auth";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const displayName = (body.displayName ?? body.display_name ?? "").trim().slice(0, 100);
  const email = (body.email as string)?.trim() || null;

  if (!displayName) return NextResponse.json({ error: "displayName required" }, { status: 400 });

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
  }

  const db = getSupabase();

  const { data: group } = await db.from("groups").select("owner_id").eq("id", id).single();
  if (!group || group.owner_id !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: member, error } = await db
    .from("group_members")
    .insert({
      group_id: id,
      user_id: null,
      email,
      display_name: displayName,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(member);
}
