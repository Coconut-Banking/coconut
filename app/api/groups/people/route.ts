import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { getAccessibleGroupIds } from "@/lib/group-access";

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

  const { data: groups } = await db
    .from("groups")
    .select("id, name")
    .in("id", ids)
    .order("created_at", { ascending: false });

  if (!groups || groups.length === 0) {
    return NextResponse.json({ people: [], groups: [] });
  }

  const { data: members } = await db
    .from("group_members")
    .select("id, group_id, user_id, email, display_name")
    .in("group_id", groups.map((g) => g.id));

  const groupMap = new Map(groups.map((g) => [g.id, g]));
  const memberCountByGroup = (members ?? []).reduce(
    (acc, m) => ({ ...acc, [m.group_id]: (acc[m.group_id] ?? 0) + 1 }),
    {} as Record<string, number>
  );

  // People: other members (exclude self), deduped by user_id or email or (group_id + member_id)
  const peopleByKey = new Map<string, { displayName: string; email: string | null; groupId: string; groupName: string; memberId: string; memberCount: number }>();

  for (const m of members ?? []) {
    if (m.user_id === userId) continue; // exclude self
    const group = groupMap.get(m.group_id);
    if (!group) continue;

    const memberCount = memberCountByGroup[m.group_id] ?? 0;
    const key = m.user_id ?? m.email ?? `${m.group_id}-${m.id}`;

    // Prefer 2-person groups for "split with person" when same person appears in multiple groups
    const existing = peopleByKey.get(key);
    const isTwoPerson = memberCount === 2;
    if (!existing || (isTwoPerson && existing.memberCount > 2)) {
      peopleByKey.set(key, {
        displayName: m.display_name,
        email: m.email ?? null,
        groupId: m.group_id,
        groupName: group.name,
        memberId: m.id,
        memberCount,
      });
    }
  }

  const people = Array.from(peopleByKey.values()).sort((a, b) =>
    a.displayName.localeCompare(b.displayName)
  );

  return NextResponse.json({
    people,
    groups: groups.map((g) => ({ id: g.id, name: g.name })),
  });
}
