/**
 * Fetch group balance data and compute max allowed settlement.
 * Prevents over-settling when "Mark paid" is clicked multiple times.
 */
import { getSupabase } from "./supabase";
import { computePairwiseBalance } from "./split-balances";
import { normalizeSplitCurrency } from "./split-balances-currency";
import { splitTransactionDedupeKey } from "./split-transaction-helpers";

export interface MaxSettlementResult {
  maxAmount: number;
  allowed: boolean;
  reason?: string;
}

/**
 * Returns the maximum settlement amount allowed from payer to receiver in a given currency.
 * Rejects/caps to prevent over-settling (e.g. from duplicate "Mark paid" clicks).
 */
export async function getMaxSettlementAllowed(
  groupId: string,
  payerMemberId: string,
  receiverMemberId: string,
  currency = "USD"
): Promise<MaxSettlementResult> {
  const cur = normalizeSplitCurrency(currency);
  const db = getSupabase();

  // Check if this is a Splitwise-imported group
  const { data: groupRow } = await db
    .from("groups")
    .select("source, external_id")
    .eq("id", groupId)
    .maybeSingle();
  const isSwGroup =
    (groupRow as { source?: string } | null)?.source === "splitwise" &&
    (groupRow as { external_id?: string } | null)?.external_id;

  const { data: splitsRaw } = await db
    .from("split_transactions")
    .select(`
      id, group_id, transaction_id, created_by, payer_member_id, amount,
      iso_currency_code, source,
      transactions(amount)
    `)
    .eq("group_id", groupId);

  // For SW groups, exclude imported splits to avoid double-counting with the SW cache
  const filtered = isSwGroup
    ? (splitsRaw ?? []).filter((s) => (s as { source?: string | null }).source !== "splitwise")
    : (splitsRaw ?? []);

  const seenKeys = new Set<string>();
  const splits = filtered.filter((s) => {
    const k = splitTransactionDedupeKey(s as { id: string; transaction_id?: string | null });
    if (seenKeys.has(k)) return false;
    seenKeys.add(k);
    return true;
  });

  if (splits.length === 0) {
    return { maxAmount: 0, allowed: false, reason: "No expenses in this group" };
  }

  const splitIds = splits.map((s) => s.id);
  const txIds = splits.map((s) => s.transaction_id).filter(Boolean);

  // Run queries 2-5 in parallel — none depend on each other, only on splitIds/txIds
  const [{ data: members }, { data: shares }, { data: settlements }, txResult] = await Promise.all([
    db.from("group_members").select("id, user_id").eq("group_id", groupId),
    db.from("split_shares").select("split_transaction_id, member_id, amount").in("split_transaction_id", splitIds),
    db.from("settlements").select("payer_member_id, receiver_member_id, amount, method, iso_currency_code").eq("group_id", groupId).eq("status", "completed"),
    txIds.length > 0
      ? db.from("transactions").select("id, clerk_user_id").in("id", txIds)
      : Promise.resolve({ data: [] as { id: string; clerk_user_id: string }[] }),
  ]);
  const txRows = txResult.data ?? [];

  const txOwnerById = new Map((txRows ?? []).map((t) => [t.id, t.clerk_user_id]));
  const memberByUserId = new Map(
    (members ?? []).filter((m) => m.user_id).map((m) => [m.user_id, m.id])
  );

  const splitCurrencyById = new Map(
    splits.map((s) => [
      s.id,
      normalizeSplitCurrency((s as { iso_currency_code?: string | null }).iso_currency_code),
    ])
  );

  const memberIdSet = new Set((members ?? []).map((m) => m.id));

  const pairwiseSplits = splits.map((s) => {
    const payerM = (s as { payer_member_id?: string | null }).payer_member_id;
    const payerMemberId =
      payerM && memberIdSet.has(payerM)
        ? payerM
        : (() => {
            const tid = s.transaction_id as string | null | undefined;
            const ownerId = tid ? txOwnerById.get(tid) : undefined;
            return ownerId ? memberByUserId.get(ownerId) ?? null : null;
          })();
    return { id: s.id, payerMemberId };
  });

  const sharesBySplitId = new Map<string, Array<{ member_id: string; amount: number }>>();
  for (const sh of shares ?? []) {
    const list = sharesBySplitId.get(sh.split_transaction_id);
    if (list) list.push({ member_id: sh.member_id, amount: Number(sh.amount) });
    else sharesBySplitId.set(sh.split_transaction_id, [{ member_id: sh.member_id, amount: Number(sh.amount) }]);
  }

  const nativeSettlements = isSwGroup
    ? (settlements ?? []).filter((s) => (s as { method?: string }).method !== "splitwise")
    : (settlements ?? []);
  const pairwiseSettlements = nativeSettlements.map((s) => ({
    payer_member_id: s.payer_member_id,
    receiver_member_id: s.receiver_member_id,
    amount: Number(s.amount),
    currency: normalizeSplitCurrency((s as { iso_currency_code?: string | null }).iso_currency_code),
  }));

  // Positive result means payer owes receiver (from receiver's perspective)
  const remaining = computePairwiseBalance(
    receiverMemberId,
    payerMemberId,
    pairwiseSplits,
    sharesBySplitId,
    pairwiseSettlements,
    splitCurrencyById,
    cur,
  );

  if (remaining <= 0) {
    return { maxAmount: 0, allowed: false, reason: "Already settled between these members in this currency" };
  }

  return { maxAmount: remaining, allowed: true };
}
