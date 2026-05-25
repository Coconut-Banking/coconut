export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { getAccessibleGroupIds } from "@/lib/group-access";
import { dedupeGroupMembersToPeople } from "@/lib/group-people-dedupe";

/**
 * Returns people the user can split with (from their groups), plus groups for group-based split.
 * Person-first flow: list people first, then groups as secondary option.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getSupabase();
  const ids = await getAccessibleGroupIds(userId);

  if (ids.length === 0) {
    return NextResponse.json({ people: [], groups: [] });
  }

  const [groupsRes, membersRes] = await Promise.all([
    db.from("groups").select("id, name").in("id", ids).order("created_at", { ascending: false }),
    db.from("group_members").select("id, group_id, user_id, email, display_name").in("group_id", ids),
  ]);

  const groups = groupsRes.data;
  const members = membersRes.data;

  if (!groups || groups.length === 0) {
    return NextResponse.json({ people: [], groups: [] });
  }

  const groupMap = new Map(groups.map((g) => [g.id, g]));
  const memberCountByGroup = new Map<string, number>();
  for (const m of members ?? []) {
    memberCountByGroup.set(m.group_id, (memberCountByGroup.get(m.group_id) ?? 0) + 1);
  }

  const people = dedupeGroupMembersToPeople(
    members ?? [],
    groupMap,
    memberCountByGroup,
    userId,
  );

  return NextResponse.json(
    { people, groups: groups.map((g) => ({ id: g.id, name: g.name })) },
    { headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=120" } }
  );
}
