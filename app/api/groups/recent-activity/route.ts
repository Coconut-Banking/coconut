import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getAccessibleGroupIds } from "@/lib/group-access";
import { getUserId } from "@/lib/auth";

/**
 * GET /api/groups/recent-activity
 * Returns recent activity across all groups for the overview feed.
 */
export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getSupabase();
  const ids = await getAccessibleGroupIds(userId);
  if (ids.length === 0) {
    return NextResponse.json({ activity: [] });
  }

  const { data: groups } = await db
    .from("groups")
    .select("id, name")
    .in("id", ids);
  const groupNames = new Map((groups ?? []).map((g) => [g.id, g.name]));

  const { data: members } = await db
    .from("group_members")
    .select("id, group_id, user_id, display_name")
    .in("group_id", ids);

  const memberByUserId = new Map<string, { id: string; group_id: string; display_name: string }[]>();
  for (const m of members ?? []) {
    if (m.user_id) {
      const list = memberByUserId.get(m.user_id) ?? [];
      list.push({ id: m.id, group_id: m.group_id, display_name: m.display_name });
      memberByUserId.set(m.user_id, list);
    }
  }

  const { data: splitsRaw } = await db
    .from("split_transactions")
    .select(`
      id, group_id, transaction_id, created_by, created_at,
      transactions(merchant_name, raw_name, amount, date)
    `)
    .in("group_id", ids)
    .order("created_at", { ascending: false })
    .limit(30);

  const seenByGroup = new Map<string, Set<string>>();
  const splits = (splitsRaw ?? []).filter((s) => {
    const seen = seenByGroup.get(s.group_id) ?? new Set();
    const tid = s.transaction_id as string;
    if (seen.has(tid)) return false;
    seen.add(tid);
    seenByGroup.set(s.group_id, seen);
    return true;
  });

  if (splits.length === 0) {
    return NextResponse.json({ activity: [] });
  }

  const splitIds = splits.map((s) => s.id);
  const { data: shares } = await db
    .from("split_shares")
    .select("split_transaction_id, member_id, amount")
    .in("split_transaction_id", splitIds);

  const txIds = splits.map((s) => s.transaction_id).filter(Boolean);
  const { data: txRows } = await db
    .from("transactions")
    .select("id, clerk_user_id")
    .in("id", txIds);
  const txOwnerById = new Map((txRows ?? []).map((t) => [t.id, t.clerk_user_id]));

  const membersByGroup = new Map<string, { id: string; user_id: string | null; display_name: string }[]>();
  for (const m of members ?? []) {
    const list = membersByGroup.get(m.group_id) ?? [];
    list.push({ id: m.id, user_id: m.user_id, display_name: m.display_name });
    membersByGroup.set(m.group_id, list);
  }

  const { data: settlements } = await db
    .from("settlements")
    .select("group_id, payer_member_id, receiver_member_id, amount")
    .in("group_id", ids)
    .eq("status", "completed");

  const activity: Array<{
    id: string;
    who: string;
    action: string;
    what: string;
    in: string;
    direction: "get_back" | "owe" | "settled";
    amount: number;
    time: string;
  }> = [];

  for (const s of splits.slice(0, 15)) {
    const tx = (s as { transactions?: { merchant_name?: string; raw_name?: string; amount?: number } }).transactions;
    const merchant = tx?.merchant_name ?? tx?.raw_name ?? "Expense";
    const txAmount = Math.abs(Number(tx?.amount ?? 0));
    const payerUserId = txOwnerById.get(s.transaction_id);
    const groupMembers = membersByGroup.get(s.group_id) ?? [];
    const myMember = groupMembers.find((m) => m.user_id === userId);
    const payerMember = payerUserId ? groupMembers.find((m) => m.user_id === payerUserId) : null;
    const shareList = (shares ?? []).filter((sh) => sh.split_transaction_id === s.id);
    const myShareRow = myMember ? shareList.find((sh) => sh.member_id === myMember.id) : null;
    const myShare = myShareRow ? Number(myShareRow.amount) : 0;

    let effectOnBalance = 0;
    let direction: "get_back" | "owe" = "owe";
    if (payerUserId === userId && myMember) {
      const othersShare = shareList
        .filter((sh) => sh.member_id !== myMember.id)
        .reduce((a, sh) => a + Number(sh.amount), 0);
      effectOnBalance = Math.round(othersShare * 100) / 100;
      direction = "get_back";
    } else if (payerMember && myMember) {
      effectOnBalance = -Math.round(myShare * 100) / 100;
      direction = "owe";
    }

    const who = payerUserId === userId ? "You" : payerMember?.display_name ?? "Someone";
    const action = "paid";
    const groupName = groupNames.get(s.group_id) ?? "";
    const createdAt = s.created_at;
    const timeAgo = formatTimeAgo(createdAt);

    activity.push({
      id: s.id,
      who,
      action: who === "You" ? "added" : action,
      what: merchant,
      in: groupName,
      direction,
      amount: Math.abs(effectOnBalance),
      time: timeAgo,
    });
  }

  return NextResponse.json({ activity });
}

function formatTimeAgo(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
