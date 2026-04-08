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

  // Round 1: all independent queries in parallel.
  // Splits use two queries so Splitwise bulk imports (fresh created_at) don't push out manual expenses.
  const [groupsRes, membersRes, byDateRes, byCreatedRes, settlementsRawRes] = await Promise.all([
    db.from("groups").select("id, name").in("id", ids),
    db.from("group_members").select("id, group_id, user_id, display_name").in("group_id", ids),
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
    db
      .from("settlements")
      .select("id, group_id, payer_member_id, receiver_member_id, amount, iso_currency_code, created_at")
      .in("group_id", ids)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  const groups = groupsRes.data;
  const members = membersRes.data;
  const settlementsRaw = settlementsRawRes.data;

  const groupNames = new Map((groups ?? []).map((g) => [g.id, g.name]));

  const memberByUserId = new Map<string, { id: string; group_id: string; display_name: string }[]>();
  for (const m of members ?? []) {
    if (m.user_id) {
      const list = memberByUserId.get(m.user_id) ?? [];
      list.push({ id: m.id, group_id: m.group_id, display_name: m.display_name });
      memberByUserId.set(m.user_id, list);
    }
  }

  // Merge and deduplicate both splits result sets
  const seenIds = new Set<string>();
  const merged = [...(byDateRes.data ?? []), ...(byCreatedRes.data ?? [])].filter((s) => {
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
  const txIds = splits.map((s) => s.transaction_id).filter(Boolean) as string[];

  // Batch shares + tx queries in parallel (previously sequential)
  const BATCH = 200;
  const allBatches = await Promise.all([
    ...Array.from({ length: Math.ceil(splitIds.length / BATCH) }, (_, i) =>
      db
        .from("split_shares")
        .select("split_transaction_id, member_id, amount")
        .in("split_transaction_id", splitIds.slice(i * BATCH, (i + 1) * BATCH))
        .then((r) => ({ type: "share" as const, data: r.data ?? [] }))
    ),
    ...Array.from({ length: Math.ceil(txIds.length / BATCH) || 1 }, (_, i) =>
      db
        .from("transactions")
        .select("id, clerk_user_id")
        .in("id", txIds.slice(i * BATCH, (i + 1) * BATCH))
        .then((r) => ({ type: "tx" as const, data: r.data ?? [] }))
    ),
  ]);

  const shares: { split_transaction_id: string; member_id: string; amount: number }[] = [];
  const txRows: { id: string; clerk_user_id: string }[] = [];
  for (const batch of allBatches) {
    if (batch.type === "share") shares.push(...batch.data);
    else txRows.push(...batch.data);
  }
  const txOwnerById = new Map(txRows.map((t) => [t.id, t.clerk_user_id]));

  // Pre-index shares by split_transaction_id for O(1) lookups
  const sharesBySplitId = new Map<string, typeof shares>();
  for (const sh of shares) {
    const list = sharesBySplitId.get(sh.split_transaction_id);
    if (list) list.push(sh);
    else sharesBySplitId.set(sh.split_transaction_id, [sh]);
  }

  const membersByGroup = new Map<string, { id: string; user_id: string | null; display_name: string }[]>();
  for (const m of members ?? []) {
    const list = membersByGroup.get(m.group_id) ?? [];
    list.push({ id: m.id, user_id: m.user_id, display_name: m.display_name });
    membersByGroup.set(m.group_id, list);
  }


  const memberById = new Map<string, { id: string; user_id: string | null; display_name: string }>();
  for (const m of members ?? []) {
    memberById.set(m.id, { id: m.id, user_id: m.user_id, display_name: m.display_name });
  }

  // Pre-compute myMember per group to avoid repeated find() inside the splits loop.
  const myMemberByGroup = new Map<
    string,
    { id: string; user_id: string | null; display_name: string } | null
  >();
  for (const [gid, gMembers] of membersByGroup) {
    myMemberByGroup.set(gid, gMembers.find((m) => m.user_id === userId) ?? null);
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
    createdAt: string;
    receiptUrl: string | null;
  };

  // Pre-build per-group member-by-ID Map for O(1) member lookups inside the loop
  const memberByGroupAndId = new Map<string, Map<string, { id: string; user_id: string | null; display_name: string }>>();
  for (const m of members ?? []) {
    let inner = memberByGroupAndId.get(m.group_id);
    if (!inner) {
      inner = new Map();
      memberByGroupAndId.set(m.group_id, inner);
    }
    inner.set(m.id, { id: m.id, user_id: m.user_id, display_name: m.display_name });
  }

  const activity: ActivityItem[] = [];

  for (const s of splits) {
    const merchant = merchantLabelFromSplitRow(
      s as { transactions?: unknown; description?: string | null }
    );
    const groupMembers = membersByGroup.get(s.group_id) ?? [];
    const groupMemberById = memberByGroupAndId.get(s.group_id);
    const myMember = myMemberByGroup.get(s.group_id) ?? null;
    const explicitPayerId = (s as { payer_member_id?: string | null }).payer_member_id;
    const payerByMemberRow =
      explicitPayerId && groupMemberById?.has(explicitPayerId)
        ? groupMemberById.get(explicitPayerId) ?? null
        : null;
    const payerUserIdFromTx = s.transaction_id ? txOwnerById.get(s.transaction_id) : undefined;
    const paidByMember =
      payerByMemberRow ??
      (payerUserIdFromTx
        ? (memberByUserId.get(payerUserIdFromTx) ?? []).find((m) => m.group_id === s.group_id) ?? null
        : null) ??
      null;
    const shareList = sharesBySplitId.get(s.id) ?? [];
    const myShareRow = myMember ? shareList.find((sh) => sh.member_id === myMember.id) : null;
    const myShare = myShareRow ? Number(myShareRow.amount) : 0;
    const currency = ((s as { iso_currency_code?: string | null }).iso_currency_code ?? "USD").trim().toUpperCase() || "USD";

    const iAmPayer = paidByMember && myMember && paidByMember.id === myMember.id;
    const iHaveShare = !!myShareRow;

    // Skip expenses where the user isn't involved (not payer AND not in shares)
    if (!iAmPayer && !iHaveShare) continue;

    let effectOnBalance = 0;
    let direction: "get_back" | "owe" = "owe";
    if (iAmPayer) {
      const othersShare = shareList
        .filter((sh) => sh.member_id !== myMember!.id)
        .reduce((a, sh) => a + Number(sh.amount), 0);
      effectOnBalance = Math.round(othersShare * 100) / 100;
      direction = "get_back";
    } else if (paidByMember && myMember) {
      effectOnBalance = -Math.round(myShare * 100) / 100;
      direction = "owe";
    }

    // "who" = who created/added the expense (Splitwise convention), fall back to payer
    const createdById = (s as { created_by?: string | null }).created_by;
    const createdByMember = createdById
      ? (memberByUserId.get(createdById) ?? []).find((m) => m.group_id === s.group_id) ?? null
      : null;
    const displayMember = createdByMember ?? paidByMember;
    const iAmDisplay = displayMember && myMember && displayMember.id === myMember.id;
    const who = iAmDisplay ? "You" : displayMember?.display_name ?? "Someone";
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
      createdAt: s.created_at,
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
        createdAt: st.created_at,
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
        createdAt: st.created_at,
        receiptUrl: null,
      });
    }
  }

  // Sort by date descending; when dates match, most recently created first
  activity.sort((a, b) => {
    const cmp = b.sortDate.localeCompare(a.sortDate);
    if (cmp !== 0) return cmp;
    return b.createdAt.localeCompare(a.createdAt);
  });
  const trimmed = activity.slice(0, 200).map(({ sortDate: _, createdAt: _c, ...rest }) => rest);

  return NextResponse.json(
    { activity: trimmed },
    { headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=60" } }
  );
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
