import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { randomUUID } from "crypto";
import { getSupabase } from "@/lib/supabase";
import { getAccessibleGroupIds } from "@/lib/group-access";
import { getUserId } from "@/lib/auth";

export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getSupabase();
  const ids = await getAccessibleGroupIds(userId);
  if (ids.length === 0) return NextResponse.json([]);

  const { data: groups } = await db
    .from("groups")
    .select("id, name, owner_id, created_at, group_type, invite_token")
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
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const name = (body.name as string)?.trim()?.slice(0, 100);
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const groupType = ["home", "trip", "couple", "other"].includes(body.group_type)
    ? body.group_type
    : "other";
  const inviteToken = `inv_${randomUUID().replace(/-/g, "")}`;

  const db = getSupabase();

  let group: { id: string; name: string; owner_id: string; created_at: string } | null = null;
  let groupErr: { message?: string } | null = null;

  const insertPayload = { owner_id: userId, name };
  const { data: g1, error: e1 } = await db
    .from("groups")
    .insert({ ...insertPayload, group_type: groupType, invite_token: inviteToken })
    .select("id, name, owner_id, created_at")
    .single();
  if (e1 && e1.message?.includes("column")) {
    const { data: g2, error: e2 } = await db
      .from("groups")
      .insert(insertPayload)
      .select("id, name, owner_id, created_at")
      .single();
    group = g2;
    groupErr = e2;
  } else {
    group = g1;
    groupErr = e1;
  }
  if (groupErr || !group) {
    return NextResponse.json({ error: groupErr?.message ?? "Failed to create group" }, { status: 500 });
  }

  const displayName = body.ownerDisplayName ?? "You";
  const ownerUser = await currentUser();
  const ownerEmail = ownerUser?.primaryEmailAddress?.emailAddress ?? null;
  await db.from("group_members").insert({
    group_id: group.id,
    user_id: userId,
    display_name: displayName,
    email: ownerEmail,
  });

  return NextResponse.json(group);
}
