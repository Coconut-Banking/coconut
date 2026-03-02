import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { computeBalances, getSuggestedSettlements } from "@/lib/split-balances";
import { canAccessGroup } from "@/lib/group-access";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const db = getSupabase();

  const { data: group } = await db.from("groups").select("*").eq("id", id).single();
  if (!group) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const allowed = await canAccessGroup(userId, id);
  if (!allowed) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let { data: members } = await db
    .from("group_members")
    .select("id, user_id, email, display_name")
    .eq("group_id", id);

  // Backfill owner email for existing groups where owner has user_id but no email
  const ownerId = group.owner_id as string;
  const ownerMember = (members ?? []).find((m) => m.user_id === ownerId && !m.email);
  if (ownerMember && ownerId) {
    try {
      const client = await clerkClient();
      const ownerUser = await client.users.getUser(ownerId);
      const ownerEmail = ownerUser?.primaryEmailAddress?.emailAddress ?? null;
      if (ownerEmail) {
        await db
          .from("group_members")
          .update({ email: ownerEmail })
          .eq("id", ownerMember.id);
        members = (members ?? []).map((m) =>
          m.id === ownerMember.id ? { ...m, email: ownerEmail } : m
        );
      }
    } catch {
      // Ignore Clerk errors (e.g. no secret key in dev)
    }
  }

  const { data: splitsRaw } = await db
    .from("split_transactions")
    .select(`
      id, transaction_id, created_by, created_at,
      transactions(merchant_name, raw_name, amount, date)
    `)
    .eq("group_id", id)
    .order("created_at", { ascending: false });

  const seenTxIds = new Set<string>();
  const splits = (splitsRaw ?? []).filter((s) => {
    const tid = s.transaction_id as string;
    if (seenTxIds.has(tid)) return false;
    seenTxIds.add(tid);
    return true;
  });

  if (splits.length === 0) {
    return NextResponse.json({
      group,
      members: members ?? [],
      activity: [],
      balances: (members ?? []).map((m) => ({ memberId: m.id, paid: 0, owed: 0, total: 0 })),
      suggestions: [],
      totalSpend: 0,
    });
  }

  const { data: shares } = await db
    .from("split_shares")
    .select("split_transaction_id, member_id, amount")
    .in("split_transaction_id", splits.map((s) => s.id));

  const { data: settlements } = await db
    .from("settlements")
    .select("payer_member_id, receiver_member_id, amount, method, status")
    .eq("group_id", id)
    .eq("status", "completed");

  const txIds = splits.map((s) => s.transaction_id).filter(Boolean);
  let txRows: { id: string; clerk_user_id: string }[] = [];
  if (txIds.length > 0) {
    const { data } = await db.from("transactions").select("id, clerk_user_id").in("id", txIds);
    txRows = data ?? [];
  }

  const txOwnerById = new Map((txRows ?? []).map((t) => [t.id, t.clerk_user_id]));
  const memberByUserId = new Map(
    (members ?? []).filter((m) => m.user_id).map((m) => [m.user_id, m.id])
  );

  // Splits are already deduped by transaction_id; build paidRows
  const paidRows: { member_id: string; amount: number }[] = [];
  for (const s of splits) {
    const tid = s.transaction_id as string;
    const ownerId = txOwnerById.get(tid);
    const memberId = ownerId ? memberByUserId.get(ownerId) : null;
    if (memberId) {
      const tx = (s as { transactions?: { amount?: number } | { amount?: number }[] }).transactions;
      const amt = Number(Array.isArray(tx) ? tx[0]?.amount : tx?.amount) || 0;
      paidRows.push({ member_id: memberId, amount: Math.abs(amt) });
    }
  }
  // Defensive: aggregate shares by (split_id, member_id) in case of duplicates
  const owedBySplitMember = new Map<string, number>();
  for (const sh of shares ?? []) {
    const key = `${sh.split_transaction_id}:${sh.member_id}`;
    owedBySplitMember.set(key, (owedBySplitMember.get(key) ?? 0) + Number(sh.amount));
  }
  const owedRows = Array.from(owedBySplitMember.entries()).map(([key, amount]) => {
    const memberId = key.split(":")[1];
    return { member_id: memberId, amount };
  });
  const paidSettlements = (settlements ?? []).map((s) => ({
    payer_member_id: s.payer_member_id,
    amount: Number(s.amount),
  }));
  const receivedSettlements = (settlements ?? []).map((s) => ({
    receiver_member_id: s.receiver_member_id,
    amount: Number(s.amount),
  }));

  const balances = computeBalances(paidRows, owedRows, paidSettlements, receivedSettlements);
  const suggestions = getSuggestedSettlements(balances);
  const totalSpend = paidRows.reduce((a, r) => a + r.amount, 0);
  const activity = splits.map((s) => {
    const tx = (s as { transactions?: { merchant_name?: string; raw_name?: string; amount?: number } }).transactions;
    const shareList = (shares ?? []).filter((sh) => sh.split_transaction_id === s.id);
    const totalShares = shareList.length;
    return {
      id: s.id,
      merchant: tx?.merchant_name ?? tx?.raw_name ?? "Unknown",
      amount: Math.abs(tx?.amount ?? 0),
      paidBy: s.created_by,
      splitCount: totalShares,
      createdAt: s.created_at,
    };
  });

  const memberMap = new Map((members ?? []).map((m) => [m.id, m]));
  return NextResponse.json({
    group,
    isOwner: group.owner_id === userId,
    members: members ?? [],
    activity,
    balances: Array.from(balances.values()),
    suggestions: suggestions.map((s) => ({
      ...s,
      fromMember: memberMap.get(s.fromMemberId),
      toMember: memberMap.get(s.toMemberId),
    })),
    totalSpend,
  });
}
