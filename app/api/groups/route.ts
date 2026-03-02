import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { getAccessibleGroupIds } from "@/lib/group-access";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getSupabase();
  const ids = await getAccessibleGroupIds(userId);
  if (ids.length === 0) return NextResponse.json([]);

  const { data: groups } = await db
    .from("groups")
    .select("id, name, owner_id, created_at")
    .in("id", ids)
    .order("created_at", { ascending: false });

  if (!groups || groups.length === 0) return NextResponse.json([]);

  const { data: memberCounts } = await db
    .from("group_members")
    .select("group_id")
    .in("group_id", groups.map((g) => g.id));

  const countByGroup = (memberCounts ?? []).reduce(
    (acc, r) => ({ ...acc, [r.group_id]: (acc[r.group_id] ?? 0) + 1 }),
    {} as Record<string, number>
  );

  return NextResponse.json(
    groups.map((g) => ({ ...g, memberCount: countByGroup[g.id] ?? 0 }))
  );
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const name = (body.name as string)?.trim();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const db = getSupabase();

  const { data: group, error: groupErr } = await db
    .from("groups")
    .insert({ owner_id: userId, name })
    .select("id, name, owner_id, created_at")
    .single();

  if (groupErr || !group) {
    return NextResponse.json({ error: groupErr?.message ?? "Failed to create group" }, { status: 500 });
  }

  const displayName = body.ownerDisplayName ?? "You";
  await db.from("group_members").insert({
    group_id: group.id,
    user_id: userId,
    display_name: displayName,
  });

  return NextResponse.json(group);
}
