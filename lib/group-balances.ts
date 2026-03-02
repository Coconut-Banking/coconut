/**
 * Fetch group balance data and compute max allowed settlement.
 * Prevents over-settling when "Mark paid" is clicked multiple times.
 */
import { getSupabase } from "./supabase";
import { computeBalances, getSuggestedSettlements } from "./split-balances";

export interface MaxSettlementResult {
  maxAmount: number;
  allowed: boolean;
  reason?: string;
}

/**
 * Returns the maximum settlement amount allowed from payer to receiver.
 * Rejects/caps to prevent over-settling (e.g. from duplicate "Mark paid" clicks).
 */
export async function getMaxSettlementAllowed(
  groupId: string,
  payerMemberId: string,
  receiverMemberId: string
): Promise<MaxSettlementResult> {
  const db = getSupabase();

  const { data: splitsRaw } = await db
    .from("split_transactions")
    .select(`
      id, transaction_id, created_by,
      transactions(amount)
    `)
    .eq("group_id", groupId);

  const seenTxIds = new Set<string>();
  const splits = (splitsRaw ?? []).filter((s) => {
    const tid = s.transaction_id as string;
    if (seenTxIds.has(tid)) return false;
    seenTxIds.add(tid);
    return true;
  });

  if (splits.length === 0) {
    return { maxAmount: 0, allowed: false, reason: "No expenses in this group" };
  }

  const { data: members } = await db
    .from("group_members")
    .select("id, user_id")
    .eq("group_id", groupId);

  const { data: shares } = await db
    .from("split_shares")
    .select("split_transaction_id, member_id, amount")
    .in("split_transaction_id", splits.map((s) => s.id));

  const { data: settlements } = await db
    .from("settlements")
    .select("payer_member_id, receiver_member_id, amount")
    .eq("group_id", groupId)
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

  const owedBySplitMember = new Map<string, number>();
  for (const sh of shares ?? []) {
    const key = `${sh.split_transaction_id}:${sh.member_id}`;
    owedBySplitMember.set(key, (owedBySplitMember.get(key) ?? 0) + Number(sh.amount));
  }
  const owedRows = Array.from(owedBySplitMember.entries()).map(([key, amount]) => ({
    member_id: key.split(":")[1],
    amount,
  }));

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

  const suggestion = suggestions.find(
    (s) => s.fromMemberId === payerMemberId && s.toMemberId === receiverMemberId
  );
  if (!suggestion || suggestion.amount <= 0) {
    return { maxAmount: 0, allowed: false, reason: "Already settled between these members" };
  }

  const existingFromPayerToReceiver = (settlements ?? [])
    .filter(
      (s) =>
        s.payer_member_id === payerMemberId && s.receiver_member_id === receiverMemberId
    )
    .reduce((sum, s) => sum + Number(s.amount), 0);

  const remaining = Math.round((suggestion.amount - existingFromPayerToReceiver) * 100) / 100;
  if (remaining <= 0) {
    return { maxAmount: 0, allowed: false, reason: "Already settled" };
  }

  return { maxAmount: remaining, allowed: true };
}
