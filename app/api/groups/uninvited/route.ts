export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";

/**
 * GET /api/groups/uninvited
 * Returns group members who haven't joined Coconut yet (user_id is null).
 * Useful after Splitwise import to suggest inviting people.
 *
 * Query params:
 *  - source=splitwise (optional, filter to Splitwise-imported groups only)
 */
export async function GET(req: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const source = url.searchParams.get("source");

  const db = getSupabase();

  let groupQuery = db
    .from("groups")
    .select("id, name, source")
    .eq("owner_id", userId);

  if (source) {
    groupQuery = groupQuery.eq("source", source);
  }

  const { data: groups } = await groupQuery;
  if (!groups || groups.length === 0) {
    return NextResponse.json({ members: [] });
  }

  const groupIds = groups.map((g) => g.id);
  const groupMap = new Map(groups.map((g) => [g.id, g]));

  const { data: members } = await db
    .from("group_members")
    .select("id, group_id, display_name, email")
    .in("group_id", groupIds)
    .is("user_id", null);

  if (!members || members.length === 0) {
    return NextResponse.json({ members: [] });
  }

  // Deduplicate by email (same person across multiple groups)
  const seen = new Map<string, {
    memberId: string;
    displayName: string;
    email: string | null;
    groups: { id: string; name: string }[];
  }>();

  for (const m of members) {
    const dedupeKey = m.email?.toLowerCase() ?? `member-${m.id}`;
    const existing = seen.get(dedupeKey);
    const group = groupMap.get(m.group_id);
    if (!group) continue;

    if (existing) {
      if (!existing.groups.some((g) => g.id === group.id)) {
        existing.groups.push({ id: group.id, name: group.name });
      }
    } else {
      seen.set(dedupeKey, {
        memberId: m.id,
        displayName: m.display_name,
        email: m.email ?? null,
        groups: [{ id: group.id, name: group.name }],
      });
    }
  }

  const result = Array.from(seen.values()).sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  );

  return NextResponse.json(
    { members: result },
    { headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=30" } }
  );
}
