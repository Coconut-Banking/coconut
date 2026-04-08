/**
 * Fetch group balance data and compute max allowed settlement.
 * Prevents over-settling when "Mark paid" is clicked multiple times.
 */
import { getSupabase } from "./supabase";
import { getSuggestedSettlements } from "./split-balances";
import { computeBalancesByCurrency, normalizeSplitCurrency } from "./split-balances-currency";
import {
  paidAmountFromSplitRow,
  splitTransactionDedupeKey,
} from "./split-transaction-helpers";

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

  const { data: splitsRaw } = await db
    .from("split_transactions")
    .select(`
      id, group_id, transaction_id, created_by, payer_member_id, amount,
      iso_currency_code,
      transactions(amount)
    `)
    .eq("group_id", groupId);

  const seenKeys = new Set<string>();
  const splits = (splitsRaw ?? []).filter((s) => {
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
    db.from("settlements").select("payer_member_id, receiver_member_id, amount, iso_currency_code").eq("group_id", groupId).eq("status", "completed"),
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
  const paidRows: { member_id: string; amount: number; currency: string }[] = [];
  for (const s of splits) {
    const tid = s.transaction_id as string | null | undefined;
    const payerM = (s as { payer_member_id?: string | null }).payer_member_id;
    const memberId =
      payerM && memberIdSet.has(payerM)
        ? payerM
        : (() => {
            const ownerId = tid ? txOwnerById.get(tid) : undefined;
            return ownerId ? memberByUserId.get(ownerId) : null;
          })();
    if (memberId) {
      const amt = paidAmountFromSplitRow(
        s as { transactions?: unknown; amount?: number | string | null }
      );
      if (amt > 0) {
        paidRows.push({
          member_id: memberId,
          amount: amt,
          currency: normalizeSplitCurrency((s as { iso_currency_code?: string | null }).iso_currency_code),
        });
      }
    }
  }

  const owedBySplitMember = new Map<string, number>();
  for (const sh of shares ?? []) {
    const key = `${sh.split_transaction_id}:${sh.member_id}`;
    owedBySplitMember.set(key, (owedBySplitMember.get(key) ?? 0) + Number(sh.amount));
  }
  const owedRows = Array.from(owedBySplitMember.entries()).map(([key, amount]) => {
    const [splitId, member_id] = key.split(":");
    return {
      member_id,
      amount,
      currency: splitCurrencyById.get(splitId) ?? "USD",
    };
  });

  const paidSettlements = (settlements ?? []).map((s) => ({
    payer_member_id: s.payer_member_id,
    amount: Number(s.amount),
    currency: normalizeSplitCurrency((s as { iso_currency_code?: string | null }).iso_currency_code),
  }));
  const receivedSettlements = (settlements ?? []).map((s) => ({
    receiver_member_id: s.receiver_member_id,
    amount: Number(s.amount),
    currency: normalizeSplitCurrency((s as { iso_currency_code?: string | null }).iso_currency_code),
  }));

  const balancesByCurrency = computeBalancesByCurrency(
    paidRows,
    owedRows,
    paidSettlements,
    receivedSettlements
  );

  const balMap = balancesByCurrency.get(cur);
  if (!balMap) {
    return { maxAmount: 0, allowed: false, reason: "No balance in this currency for this group" };
  }

  const suggestions = getSuggestedSettlements(balMap);
  const suggestion = suggestions.find(
    (s) => s.fromMemberId === payerMemberId && s.toMemberId === receiverMemberId
  );
  if (!suggestion || suggestion.amount <= 0) {
    return { maxAmount: 0, allowed: false, reason: "Already settled between these members in this currency" };
  }

  const existingFromPayerToReceiver = (settlements ?? [])
    .filter(
      (s) =>
        s.payer_member_id === payerMemberId &&
        s.receiver_member_id === receiverMemberId &&
        normalizeSplitCurrency((s as { iso_currency_code?: string | null }).iso_currency_code) === cur
    )
    .reduce((sum, s) => sum + Number(s.amount), 0);

  const remaining = Math.round((suggestion.amount - existingFromPayerToReceiver) * 100) / 100;
  if (remaining <= 0) {
    return { maxAmount: 0, allowed: false, reason: "Already settled" };
  }

  return { maxAmount: remaining, allowed: true };
}
