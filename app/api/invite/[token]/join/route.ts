export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { getUserId } from "@/lib/auth";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!token || !token.startsWith("inv_")) {
    return NextResponse.json({ error: "Invalid invite link" }, { status: 404 });
  }

  const db = getSupabase();

  const { data: group, error: groupErr } = await db
    .from("groups")
    .select("id, name, owner_id")
    .eq("invite_token", token)
    .maybeSingle();

  if (groupErr || !group) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }

  if (group.owner_id === userId) {
    return NextResponse.json({
      joined: true,
      alreadyMember: true,
      groupId: group.id,
      groupName: group.name,
    });
  }

  const { data: existing } = await db
    .from("group_members")
    .select("id")
    .eq("group_id", group.id)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({
      joined: true,
      alreadyMember: true,
      groupId: group.id,
      groupName: group.name,
    });
  }

  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? null;
  const displayName = user?.fullName || user?.firstName || "Member";

  if (email) {
    const { data: placeholder } = await db
      .from("group_members")
      .select("id")
      .eq("group_id", group.id)
      .eq("email", email.toLowerCase())
      .is("user_id", null)
      .maybeSingle();

    if (placeholder) {
      await db
        .from("group_members")
        .update({ user_id: userId, display_name: displayName, joined_via: "invite_link" })
        .eq("id", placeholder.id);

      return NextResponse.json({
        joined: true,
        alreadyMember: false,
        groupId: group.id,
        groupName: group.name,
      });
    }
  }

  const { error: insertErr } = await db.from("group_members").insert({
    group_id: group.id,
    user_id: userId,
    display_name: displayName,
    email: email?.toLowerCase() ?? null,
    joined_via: "invite_link",
  });

  if (insertErr) {
    console.error("[invite/join] insert error:", insertErr);
    return NextResponse.json({ error: "Failed to join group" }, { status: 500 });
  }

  return NextResponse.json({
    joined: true,
    alreadyMember: false,
    groupId: group.id,
    groupName: group.name,
  });
}
