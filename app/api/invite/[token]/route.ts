export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  if (!token || !token.startsWith("inv_")) {
    return NextResponse.json({ error: "Invalid invite link" }, { status: 404 });
  }

  const db = getSupabase();

  const { data: group, error } = await db
    .from("groups")
    .select("id, name, owner_id, group_type")
    .eq("invite_token", token)
    .maybeSingle();

  if (error || !group) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }

  const [membersRes, recentSplitsRes] = await Promise.all([
    db.from("group_members").select("display_name, user_id").eq("group_id", group.id).order("created_at", { ascending: true }),
    db.from("split_transactions").select("description, amount").eq("group_id", group.id).order("created_at", { ascending: false }).limit(3),
  ]);

  const members = membersRes.data;
  const recentSplits = recentSplitsRes.data;
  const ownerMember = (members ?? []).find((m) => m.user_id === group.owner_id);

  return NextResponse.json(
    {
      groupId: group.id,
      groupName: group.name,
      groupType: group.group_type ?? "other",
      memberCount: (members ?? []).length,
      inviterName: ownerMember?.display_name ?? "Someone",
      members: (members ?? []).map((m) => ({
        display_name: m.display_name,
        initial: m.display_name?.charAt(0)?.toUpperCase() ?? "?",
        is_owner: m.user_id === group.owner_id,
      })),
      recentExpenses: (recentSplits ?? [])
        .filter((s) => s.description && s.amount != null)
        .map((s) => ({
          description: s.description,
          amount: Number(s.amount),
        })),
    },
    { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=600" } }
  );
}
