import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { computeBalances, getSuggestedSettlements } from "@/lib/split-balances";
import { getAccessibleGroupIds } from "@/lib/group-access";

/**
 * GET /api/groups/person?key=xxx
 * Returns person detail: balance, transactions across all shared groups, settlement info.
 * Key = user_id | email | groupId-memberId (for deduping)
 */
export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const key = req.nextUrl.searchParams.get("key");
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });

  const db = getSupabase();
  const ids = await getAccessibleGroupIds(userId);

  if (ids.length === 0) {
    return NextResponse.json(
      { displayName: null, balance: 0, activity: [], email: null, settlements: [] },
      { status: 200 }
    );
  }

  const { data: groups } = await db
    .from("groups")
    .select("id, name, owner_id")
    .in("id", ids);

  const { data: members } = await db
    .from("group_members")
    .select("id, group_id, user_id, email, display_name")
    .in("group_id", ids);

  // Find the person by key (user_id, email, or groupId-memberId)
  const personMembers = (members ?? []).filter((m) => {
    if (m.user_id === userId) return false;
    if (m.user_id && m.user_id === key) return true;
    if (m.email && m.email === key) return true;
    if (`${m.group_id}-${m.id}` === key) return true;
    return false;
  });

  if (personMembers.length === 0) {
    return NextResponse.json(
      { displayName: null, balance: 0, activity: [], email: null, settlements: [] },
      { status: 404 }
    );
  }

  const displayName = personMembers[0].display_name;
  const email = personMembers[0].email ?? null;
  const sharedGroupIds = [...new Set(personMembers.map((m) => m.group_id))];
  const personMemberIds = new Set(personMembers.map((m) => m.id));

  const { data: splitsRaw } = await db
    .from("split_transactions")
    .select(`
      id, group_id, transaction_id, created_by, created_at,
      transactions(merchant_name, raw_name, amount, date)
    `)
    .in("group_id", sharedGroupIds)
    .order("created_at", { ascending: false });

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
    return NextResponse.json({
      displayName,
      balance: 0,
      activity: [],
      email,
      key,
      settlements: [],
    });
  }

  const { data: shares } = await db
    .from("split_shares")
    .select("split_transaction_id, member_id, amount")
    .in("split_transaction_id", splits.map((s) => s.id));

  const { data: settlements } = await db
    .from("settlements")
    .select("group_id, payer_member_id, receiver_member_id, amount")
    .in("group_id", sharedGroupIds)
    .eq("status", "completed");

  const txIds = splits.map((s) => s.transaction_id).filter(Boolean);
  let txRows: { id: string; clerk_user_id: string }[] = [];
  if (txIds.length > 0) {
    const { data } = await db.from("transactions").select("id, clerk_user_id").in("id", txIds);
    txRows = data ?? [];
  }

  const txOwnerById = new Map(txRows.map((t) => [t.id, t.clerk_user_id]));
  const groupNames = new Map((groups ?? []).map((g) => [g.id, g.name]));

  let totalBalanceWithPerson = 0;
  const personSettlements: Array<{ groupId: string; fromMemberId: string; toMemberId: string; amount: number }> = [];
  const activity: Array<{
    id: string;
    merchant: string;
    amount: number;
    groupName: string;
    paidByMe: boolean;
    paidByThem: boolean;
    myShare: number;
    theirShare: number;
    effectOnBalance: number;
    createdAt: string;
  }> = [];

  for (const groupId of sharedGroupIds) {
    const groupSplits = splits.filter((s) => s.group_id === groupId);
    const groupMembers = (members ?? []).filter((m) => m.group_id === groupId);
    const myMember = groupMembers.find((m) => m.user_id === userId);
    const theirMember = groupMembers.find((m) => personMemberIds.has(m.id));
    if (!myMember || !theirMember) continue;

    const memberByUserId = new Map(
      groupMembers.filter((m) => m.user_id).map((m) => [m.user_id!, m.id])
    );

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
    const owedRows = (shares ?? [])
      .filter((sh) => groupShareIds.includes(sh.split_transaction_id))
      .map((s) => ({ member_id: s.member_id, amount: Number(s.amount) }));

    const groupSettlements = (settlements ?? []).filter((s) => s.group_id === groupId);
    const paidSettlements = groupSettlements.map((s) => ({
      payer_member_id: s.payer_member_id,
      amount: Number(s.amount),
    }));
    const receivedSettlements = groupSettlements.map((s) => ({
      receiver_member_id: s.receiver_member_id,
      amount: Number(s.amount),
    }));

    const balances = computeBalances(paidRows, owedRows, paidSettlements, receivedSettlements);
    const theirBalance = balances.get(theirMember.id)?.total ?? 0;
    const myBalanceWithThem = Math.round(-theirBalance * 100) / 100;
    totalBalanceWithPerson += myBalanceWithThem;

    const suggestions = getSuggestedSettlements(balances);
    for (const s of suggestions) {
      const involvesMe = s.fromMemberId === myMember.id || s.toMemberId === myMember.id;
      const involvesThem = s.fromMemberId === theirMember.id || s.toMemberId === theirMember.id;
      if (involvesMe && involvesThem) {
        personSettlements.push({
          groupId,
          fromMemberId: s.fromMemberId,
          toMemberId: s.toMemberId,
          amount: s.amount,
        });
      }
    }

    for (const s of groupSplits) {
      const tx = (s as { transactions?: { merchant_name?: string; raw_name?: string; amount?: number } })
        .transactions;
      const shareList = (shares ?? []).filter((sh) => sh.split_transaction_id === s.id);
      const totalShares = shareList.length;
      const txAmount = Math.abs(tx?.amount ?? 0);
      const payerUserId = txOwnerById.get(s.transaction_id);
      const payerMemberId = payerUserId ? memberByUserId.get(payerUserId) : null;

      const paidByMe = payerMemberId === myMember.id;
      const paidByThem = payerMemberId === theirMember.id;
      const myShareRow = shareList.find((sh) => sh.member_id === myMember.id);
      const theirShareRow = shareList.find((sh) => sh.member_id === theirMember.id);
      const myShare = myShareRow ? Number(myShareRow.amount) : 0;
      const theirShare = theirShareRow ? Number(theirShareRow.amount) : 0;

      // Effect: if I paid, they owe me (positive). If they paid, I owe them (negative).
      let effectOnBalance = 0;
      if (paidByMe && theirShare > 0) effectOnBalance = theirShare;
      else if (paidByThem && myShare > 0) effectOnBalance = -myShare;

      activity.push({
        id: s.id,
        merchant: tx?.merchant_name ?? tx?.raw_name ?? "Unknown",
        amount: txAmount,
        groupName: groupNames.get(groupId) ?? "",
        paidByMe,
        paidByThem,
        myShare,
        theirShare,
        effectOnBalance,
        createdAt: s.created_at,
      });
    }
  }

  activity.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return NextResponse.json({
    displayName,
    balance: Math.round(totalBalanceWithPerson * 100) / 100,
    activity,
    email,
    key,
    settlements: personSettlements,
  });
}
