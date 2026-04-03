export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getAccessibleGroupIds } from "@/lib/group-access";
import { getUserId } from "@/lib/auth";
import { merchantLabelFromSplitRow, splitTransactionDedupeKey } from "@/lib/split-transaction-helpers";

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

  // Fetch recent expenses — use two queries to ensure manual expenses aren't
  // pushed out when a Splitwise bulk import fills up the limit with fresh created_at.
  const [{ data: byDate }, { data: byCreated }] = await Promise.all([
    db
      .from("split_transactions")
      .select(`
        id, group_id, transaction_id, created_by, created_at, date, description,
        payer_member_id, amount, iso_currency_code, receipt_url,
        transactions(merchant_name, raw_name, amount, date)
      `)
      .in("group_id", ids)
      .not("date", "is", null)
      .order("date", { ascending: false })
      .limit(500),
    db
      .from("split_transactions")
      .select(`
        id, group_id, transaction_id, created_by, created_at, date, description,
        payer_member_id, amount, iso_currency_code, receipt_url,
        transactions(merchant_name, raw_name, amount, date)
      `)
      .in("group_id", ids)
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  // Merge and deduplicate both result sets
  const seenIds = new Set<string>();
  const merged = [...(byDate ?? []), ...(byCreated ?? [])].filter((s) => {
    if (seenIds.has(s.id)) return false;
    seenIds.add(s.id);
    return true;
  });

  const seenByGroup = new Map<string, Set<string>>();
  const deduped = merged.filter((s) => {
    const seen = seenByGroup.get(s.group_id) ?? new Set();
    const k = splitTransactionDedupeKey(s as { id: string; transaction_id?: string | null });
    if (seen.has(k)) return false;
    seen.add(k);
    seenByGroup.set(s.group_id, seen);
    return true;
  });

  const splits = deduped.sort((a, b) => {
    const da = (a as { date?: string }).date ?? a.created_at;
    const db_ = (b as { date?: string }).date ?? b.created_at;
    return db_.localeCompare(da);
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

  // Fetch settlements for the activity feed too
  const { data: settlementsRaw } = await db
    .from("settlements")
    .select("id, group_id, payer_member_id, receiver_member_id, amount, iso_currency_code, created_at")
    .in("group_id", ids)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(200);

  const memberById = new Map<string, { id: string; user_id: string | null; display_name: string }>();
  for (const m of members ?? []) {
    memberById.set(m.id, { id: m.id, user_id: m.user_id, display_name: m.display_name });
  }

  type ActivityItem = {
    id: string;
    who: string;
    action: string;
    what: string;
    in: string;
    direction: "get_back" | "owe" | "settled";
    amount: number;
    currency: string;
    time: string;
    sortDate: string;
    receiptUrl: string | null;
  };

  const activity: ActivityItem[] = [];

  for (const s of splits) {
    const merchant = merchantLabelFromSplitRow(
      s as { transactions?: unknown; description?: string | null }
    );
    const groupMembers = membersByGroup.get(s.group_id) ?? [];
    const myMember = groupMembers.find((m) => m.user_id === userId);
    const explicitPayerId = (s as { payer_member_id?: string | null }).payer_member_id;
    const payerByMemberRow =
      explicitPayerId && groupMembers.some((m) => m.id === explicitPayerId)
        ? groupMembers.find((m) => m.id === explicitPayerId) ?? null
        : null;
    const payerUserIdFromTx = s.transaction_id ? txOwnerById.get(s.transaction_id) : undefined;
    const paidByMember =
      payerByMemberRow ??
      (payerUserIdFromTx ? groupMembers.find((m) => m.user_id === payerUserIdFromTx) : null) ??
      null;
    const shareList = (shares ?? []).filter((sh) => sh.split_transaction_id === s.id);
    const myShareRow = myMember ? shareList.find((sh) => sh.member_id === myMember.id) : null;
    const myShare = myShareRow ? Number(myShareRow.amount) : 0;
    const currency = ((s as { iso_currency_code?: string | null }).iso_currency_code ?? "USD").trim().toUpperCase() || "USD";

    let effectOnBalance = 0;
    let direction: "get_back" | "owe" = "owe";
    if (paidByMember && myMember && paidByMember.id === myMember.id) {
      const othersShare = shareList
        .filter((sh) => sh.member_id !== myMember.id)
        .reduce((a, sh) => a + Number(sh.amount), 0);
      effectOnBalance = Math.round(othersShare * 100) / 100;
      direction = "get_back";
    } else if (paidByMember && myMember) {
      effectOnBalance = -Math.round(myShare * 100) / 100;
      direction = "owe";
    }

    const who =
      paidByMember && myMember && paidByMember.id === myMember.id
        ? "You"
        : paidByMember?.display_name ?? "Someone";
    const groupName = groupNames.get(s.group_id) ?? "";
    const expenseDate = (s as { date?: string }).date ?? s.created_at;

    activity.push({
      id: s.id,
      who,
      action: "added",
      what: merchant,
      in: groupName,
      direction,
      amount: Math.abs(effectOnBalance),
      currency,
      time: formatTimeAgo(expenseDate),
      sortDate: expenseDate,
      receiptUrl: (s as { receipt_url?: string | null }).receipt_url ?? null,
    });
  }

  // Add settlements to activity
  for (const st of settlementsRaw ?? []) {
    const payer = memberById.get(st.payer_member_id);
    const receiver = memberById.get(st.receiver_member_id);
    if (!payer || !receiver) continue;

    const iAmPayer = payer.user_id === userId;
    const iAmReceiver = receiver.user_id === userId;
    const currency = (st.iso_currency_code ?? "USD").trim().toUpperCase() || "USD";
    const groupName = groupNames.get(st.group_id) ?? "";
    const amt = Number(st.amount);

    if (iAmPayer) {
      activity.push({
        id: `st-${st.id}`,
        who: "You",
        action: "paid",
        what: receiver.display_name,
        in: groupName,
        direction: "settled",
        amount: amt,
        currency,
        time: formatTimeAgo(st.created_at),
        sortDate: st.created_at,
        receiptUrl: null,
      });
    } else if (iAmReceiver) {
      activity.push({
        id: `st-${st.id}`,
        who: payer.display_name,
        action: "paid",
        what: "you",
        in: groupName,
        direction: "settled",
        amount: amt,
        currency,
        time: formatTimeAgo(st.created_at),
        sortDate: st.created_at,
        receiptUrl: null,
      });
    }
  }

  // Sort all activity by date descending, take top 30
  activity.sort((a, b) => b.sortDate.localeCompare(a.sortDate));
  const trimmed = activity.slice(0, 200).map(({ sortDate: _, ...rest }) => rest);

  return NextResponse.json({ activity: trimmed });
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
