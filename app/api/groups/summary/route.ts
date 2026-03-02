import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { computeBalances } from "@/lib/split-balances";
import { getAccessibleGroupIds } from "@/lib/group-access";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getSupabase();
  const ids = await getAccessibleGroupIds(userId);

  if (ids.length === 0) {
    return NextResponse.json({
      groups: [],
      friends: [],
      totalOwedToMe: 0,
      totalIOwe: 0,
      netBalance: 0,
    });
  }

  const { data: groups } = await db
    .from("groups")
    .select("id, name, owner_id, created_at")
    .in("id", ids)
    .order("created_at", { ascending: false });

  const groupIds = (groups ?? []).map((g) => g.id);

  const { data: members } = await db
    .from("group_members")
    .select("id, group_id, user_id, display_name, email")
    .in("group_id", groupIds);

  const { data: splits } = await db
    .from("split_transactions")
    .select(`
      id, group_id, transaction_id, created_by, created_at,
      transactions(amount)
    `)
    .in("group_id", groupIds)
    .order("created_at", { ascending: false });

  const splitIds = (splits ?? []).map((s) => s.id);

  let shares: { split_transaction_id: string; member_id: string; amount: number }[] = [];
  let txRows: { id: string; clerk_user_id: string }[] = [];

  if (splitIds.length > 0) {
    const { data: sharesData } = await db
      .from("split_shares")
      .select("split_transaction_id, member_id, amount")
      .in("split_transaction_id", splitIds);
    shares = sharesData ?? [];
  }

  const txIds = (splits ?? []).map((s) => s.transaction_id).filter(Boolean);
  if (txIds.length > 0) {
    const { data } = await db.from("transactions").select("id, clerk_user_id").in("id", txIds);
    txRows = data ?? [];
  }

  const { data: settlements } = await db
    .from("settlements")
    .select("group_id, payer_member_id, receiver_member_id, amount")
    .in("group_id", groupIds)
    .eq("status", "completed");

  const memberByGroup = new Map<string, { id: string; user_id: string | null; display_name: string; email: string | null }[]>();
  for (const m of members ?? []) {
    const list = memberByGroup.get(m.group_id) ?? [];
    list.push({ id: m.id, user_id: m.user_id, display_name: m.display_name, email: m.email ?? null });
    memberByGroup.set(m.group_id, list);
  }

  const txOwnerById = new Map(txRows.map((t) => [t.id, t.clerk_user_id]));
  const splitByGroup = new Map<string, typeof splits>();
  const seenByGroup = new Map<string, Set<string>>();
  for (const s of splits ?? []) {
    const seen = seenByGroup.get(s.group_id) ?? new Set();
    const tid = s.transaction_id as string;
    if (seen.has(tid)) continue;
    seen.add(tid);
    seenByGroup.set(s.group_id, seen);
    const list = splitByGroup.get(s.group_id) ?? [];
    list.push(s);
    splitByGroup.set(s.group_id, list);
  }

  let totalOwedToMe = 0;
  let totalIOwe = 0;
  const personBalances = new Map<string, { displayName: string; balance: number }>();

  const groupsWithBalance = (groups ?? []).map((g) => {
    const groupSplits = splitByGroup.get(g.id) ?? [];
    const groupMembers = memberByGroup.get(g.id) ?? [];
    const myMember = groupMembers.find((m) => m.user_id === userId);
    const memberByUserId = new Map(
      groupMembers.filter((m) => m.user_id).map((m) => [m.user_id!, m.id])
    );

    // When there are no splits, treat balance as 0 (matches group detail behavior).
    // Avoids showing stale amounts from orphaned settlements.
    if (groupSplits.length === 0) {
      const lastActivityAt = g.created_at;
      return {
        id: g.id,
        name: g.name,
        memberCount: groupMembers.length,
        myBalance: 0,
        lastActivityAt,
      };
    }

    const paidRows: { member_id: string; amount: number }[] = [];
    for (const s of groupSplits) {
      const ownerId = txOwnerById.get(s.transaction_id);
      const memberId = ownerId ? memberByUserId.get(ownerId) : null;
      if (memberId) {
        const tx = (s as { transactions?: { amount?: number } | { amount?: number }[] }).transactions;
        const amt = Number(Array.isArray(tx) ? tx[0]?.amount : tx?.amount) || 0;
        paidRows.push({ member_id: memberId, amount: Math.abs(amt) });
      }
    }

    const groupShareIds = groupSplits.map((x) => x.id);
    const owedRows = shares
      .filter((sh) => groupShareIds.includes(sh.split_transaction_id))
      .map((s) => ({ member_id: s.member_id, amount: Number(s.amount) }));

    const groupSettlements = (settlements ?? []).filter((s) => s.group_id === g.id);
    const paidSettlements = groupSettlements.map((s) => ({
      payer_member_id: s.payer_member_id,
      amount: Number(s.amount),
    }));
    const receivedSettlements = groupSettlements.map((s) => ({
      receiver_member_id: s.receiver_member_id,
      amount: Number(s.amount),
    }));

    const balances = computeBalances(
      paidRows,
      owedRows,
      paidSettlements,
      receivedSettlements
    );

    const myBalance = myMember ? balances.get(myMember.id)?.total ?? 0 : 0;
    if (myBalance > 0) totalOwedToMe += myBalance;
    else if (myBalance < 0) totalIOwe += Math.abs(myBalance);

    // Aggregate per-person balances (my net with each other member)
    for (const m of groupMembers) {
      if (m.user_id === userId) continue;
      const theirBalance = balances.get(m.id)?.total ?? 0;
      const myBalanceWithThem = Math.round(-theirBalance * 100) / 100;
      const key = m.user_id ?? m.email ?? `${g.id}-${m.id}`;
      const existing = personBalances.get(key);
      const next = (existing?.balance ?? 0) + myBalanceWithThem;
      const rounded = Math.round(next * 100) / 100;
      personBalances.set(key, {
        displayName: existing?.displayName ?? m.display_name,
        balance: rounded,
      });
    }

    const lastSplit = groupSplits[0];
    const lastActivityAt = lastSplit?.created_at ?? g.created_at;

    return {
      id: g.id,
      name: g.name,
      memberCount: groupMembers.length,
      myBalance: Math.round(myBalance * 100) / 100,
      lastActivityAt,
    };
  });

  const netBalance = Math.round((totalOwedToMe - totalIOwe) * 100) / 100;

  const friends = Array.from(personBalances.entries())
    .map(([key, v]) => ({ key, displayName: v.displayName, balance: v.balance }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  return NextResponse.json({
    groups: groupsWithBalance,
    friends,
    totalOwedToMe: Math.round(totalOwedToMe * 100) / 100,
    totalIOwe: Math.round(totalIOwe * 100) / 100,
    netBalance,
  });
}
