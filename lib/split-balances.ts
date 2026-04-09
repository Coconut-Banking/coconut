/**
 * Shared expense balance and settlement logic.
 * Debt minimization adapted from Spliit (MIT): https://github.com/spliit-app/spliit
 * See src/lib/balances.ts — greedy creditor/debtor matching with stable sort.
 */

export interface MemberBalance {
  memberId: string;
  paid: number;
  owed: number;
  total: number;
}

export interface SettlementSuggestion {
  fromMemberId: string;
  toMemberId: string;
  amount: number;
}

/**
 * Compute net balance per member from raw rows.
 * total = paid - owed, then adjusted by settlements:
 * - When you PAY a settlement, your debt decreases → total += amount
 * - When you RECEIVE a settlement, your credit decreases → total -= amount
 */
export function computeBalances(
  paidRows: { member_id: string; amount: number }[],
  owedRows: { member_id: string; amount: number }[],
  paidSettlements: { payer_member_id: string; amount: number }[],
  receivedSettlements: { receiver_member_id: string; amount: number }[]
): Map<string, MemberBalance> {
  const map = new Map<string, MemberBalance>();

  function ensure(id: string) {
    if (!map.has(id)) map.set(id, { memberId: id, paid: 0, owed: 0, total: 0 });
    return map.get(id)!;
  }

  for (const r of paidRows) {
    ensure(r.member_id).paid += Number(r.amount);
  }
  for (const r of owedRows) {
    ensure(r.member_id).owed += Number(r.amount);
  }
  for (const r of paidSettlements) {
    ensure(r.payer_member_id).total += Number(r.amount); // payer's debt decreases
  }
  for (const r of receivedSettlements) {
    ensure(r.receiver_member_id).total -= Number(r.amount); // receiver's credit decreases
  }

  for (const m of map.values()) {
    m.total += m.paid - m.owed;
    m.paid = Math.round(m.paid * 100) / 100;
    m.owed = Math.round(m.owed * 100) / 100;
    m.total = Math.round(m.total * 100) / 100;
  }
  return map;
}

/**
 * Direct pairwise balance between two members in a single group/currency.
 *
 * Returns the net from memberA's perspective:
 *   positive → memberB owes memberA
 *   negative → memberA owes memberB
 *
 * Unlike getSuggestedSettlements (group-wide debt minimization), this
 * reflects the actual debt between two specific people — matching what
 * the person detail screen displays.
 */
export function computePairwiseBalance(
  memberAId: string,
  memberBId: string,
  splits: ReadonlyArray<{ id: string; payerMemberId: string | null }>,
  sharesBySplitId: ReadonlyMap<string, ReadonlyArray<{ member_id: string; amount: number }>>,
  settlements: ReadonlyArray<{
    payer_member_id: string;
    receiver_member_id: string;
    amount: number;
    currency: string;
  }>,
  splitCurrencyById: ReadonlyMap<string, string>,
  currency: string,
): number {
  let balance = 0;

  for (const split of splits) {
    const cur = splitCurrencyById.get(split.id) ?? "USD";
    if (cur !== currency) continue;
    const shares = sharesBySplitId.get(split.id) ?? [];

    if (split.payerMemberId === memberAId) {
      const bShare = shares.find((s) => s.member_id === memberBId);
      if (bShare) balance += Number(bShare.amount);
    } else if (split.payerMemberId === memberBId) {
      const aShare = shares.find((s) => s.member_id === memberAId);
      if (aShare) balance -= Number(aShare.amount);
    }
  }

  for (const st of settlements) {
    if (st.currency !== currency) continue;
    if (st.payer_member_id === memberAId && st.receiver_member_id === memberBId) {
      balance += Number(st.amount);
    } else if (st.payer_member_id === memberBId && st.receiver_member_id === memberAId) {
      balance -= Number(st.amount);
    }
  }

  return Math.round(balance * 100) / 100;
}

/**
 * Stable comparator for settlement suggestions (Spliit-style).
 * Ensures that executing one suggested reimbursement does not cause
 * the remaining suggestions to shuffle randomly — deterministic ordering.
 */
function compareBalancesForSettlements(
  a: { memberId: string; total: number },
  b: { memberId: string; total: number }
): number {
  if (a.total > 0 && b.total < 0) return -1;
  if (a.total < 0 && b.total > 0) return 1;
  return a.memberId.localeCompare(b.memberId);
}

/**
 * Greedy debt minimization (Spliit-style).
 * Credits (positive) first, debts (negative) last; when signs match, sort by memberId.
 * Pairs largest debtor with largest creditor, settles min(creditor_owed, |debtor_owes|).
 * Minimizes number of settlement transactions.
 */
export function getSuggestedSettlements(
  balances: Map<string, MemberBalance>
): SettlementSuggestion[] {
  const arr = Array.from(balances.values())
    .filter((b) => Math.round(b.total * 100) / 100 !== 0)
    .map((b) => ({ memberId: b.memberId, total: b.total }));

  arr.sort(compareBalancesForSettlements);

  const suggestions: SettlementSuggestion[] = [];
  while (arr.length >= 2) {
    const first = arr[0];
    const last = arr[arr.length - 1];

    if (first.total <= 0 || last.total >= 0) break;

    const amount = first.total + last.total;

    if (first.total > -last.total) {
      const amt = Math.round(-last.total * 100) / 100;
      if (amt > 0) {
        suggestions.push({
          fromMemberId: last.memberId,
          toMemberId: first.memberId,
          amount: amt,
        });
      }
      first.total = amount;
      arr.pop();
    } else {
      const amt = Math.round(first.total * 100) / 100;
      if (amt > 0) {
        suggestions.push({
          fromMemberId: last.memberId,
          toMemberId: first.memberId,
          amount: amt,
        });
      }
      last.total = amount;
      arr.shift();
    }
  }

  return suggestions.filter((s) => Math.round(s.amount * 100) / 100 > 0);
}
