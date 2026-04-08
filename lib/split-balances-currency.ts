/**
 * Run balance math separately per ISO currency — never add across currencies.
 */

import { computeBalances, type MemberBalance } from "./split-balances";

export function normalizeSplitCurrency(code: string | null | undefined): string {
  const c = (code ?? "USD").trim().toUpperCase();
  return c.length > 0 ? c : "USD";
}

export function computeBalancesByCurrency(
  paidRows: { member_id: string; amount: number; currency: string }[],
  owedRows: { member_id: string; amount: number; currency: string }[],
  paidSettlements: { payer_member_id: string; amount: number; currency: string }[],
  receivedSettlements: { receiver_member_id: string; amount: number; currency: string }[]
): Map<string, Map<string, MemberBalance>> {
  // Pre-bucket each row into its currency group in a single pass (O(n) total).
  const paidByCur = new Map<string, { member_id: string; amount: number }[]>();
  const owedByCur = new Map<string, { member_id: string; amount: number }[]>();
  const paidSetByCur = new Map<string, { payer_member_id: string; amount: number }[]>();
  const recvSetByCur = new Map<string, { receiver_member_id: string; amount: number }[]>();

  for (const r of paidRows) {
    const c = normalizeSplitCurrency(r.currency);
    const arr = paidByCur.get(c) ?? [];
    arr.push({ member_id: r.member_id, amount: r.amount });
    paidByCur.set(c, arr);
  }
  for (const r of owedRows) {
    const c = normalizeSplitCurrency(r.currency);
    const arr = owedByCur.get(c) ?? [];
    arr.push({ member_id: r.member_id, amount: r.amount });
    owedByCur.set(c, arr);
  }
  for (const r of paidSettlements) {
    const c = normalizeSplitCurrency(r.currency);
    const arr = paidSetByCur.get(c) ?? [];
    arr.push({ payer_member_id: r.payer_member_id, amount: r.amount });
    paidSetByCur.set(c, arr);
  }
  for (const r of receivedSettlements) {
    const c = normalizeSplitCurrency(r.currency);
    const arr = recvSetByCur.get(c) ?? [];
    arr.push({ receiver_member_id: r.receiver_member_id, amount: r.amount });
    recvSetByCur.set(c, arr);
  }

  const currencies = new Set([
    ...paidByCur.keys(),
    ...owedByCur.keys(),
    ...paidSetByCur.keys(),
    ...recvSetByCur.keys(),
  ]);

  const out = new Map<string, Map<string, MemberBalance>>();
  for (const cur of currencies) {
    out.set(
      cur,
      computeBalances(
        paidByCur.get(cur) ?? [],
        owedByCur.get(cur) ?? [],
        paidSetByCur.get(cur) ?? [],
        recvSetByCur.get(cur) ?? []
      )
    );
  }
  return out;
}
