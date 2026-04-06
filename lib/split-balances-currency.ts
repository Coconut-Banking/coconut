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
  // Single-pass: group all rows by normalized currency
  const paidByCur = new Map<string, { member_id: string; amount: number }[]>();
  for (const r of paidRows) {
    const cur = normalizeSplitCurrency(r.currency);
    let list = paidByCur.get(cur);
    if (!list) { list = []; paidByCur.set(cur, list); }
    list.push({ member_id: r.member_id, amount: r.amount });
  }

  const owedByCur = new Map<string, { member_id: string; amount: number }[]>();
  for (const r of owedRows) {
    const cur = normalizeSplitCurrency(r.currency);
    let list = owedByCur.get(cur);
    if (!list) { list = []; owedByCur.set(cur, list); }
    list.push({ member_id: r.member_id, amount: r.amount });
  }

  const paidSettByCur = new Map<string, { payer_member_id: string; amount: number }[]>();
  for (const r of paidSettlements) {
    const cur = normalizeSplitCurrency(r.currency);
    let list = paidSettByCur.get(cur);
    if (!list) { list = []; paidSettByCur.set(cur, list); }
    list.push({ payer_member_id: r.payer_member_id, amount: r.amount });
  }

  const recvSettByCur = new Map<string, { receiver_member_id: string; amount: number }[]>();
  for (const r of receivedSettlements) {
    const cur = normalizeSplitCurrency(r.currency);
    let list = recvSettByCur.get(cur);
    if (!list) { list = []; recvSettByCur.set(cur, list); }
    list.push({ receiver_member_id: r.receiver_member_id, amount: r.amount });
  }

  // Collect all currencies
  const currencies = new Set<string>();
  for (const k of paidByCur.keys()) currencies.add(k);
  for (const k of owedByCur.keys()) currencies.add(k);
  for (const k of paidSettByCur.keys()) currencies.add(k);
  for (const k of recvSettByCur.keys()) currencies.add(k);

  const out = new Map<string, Map<string, MemberBalance>>();
  for (const cur of currencies) {
    out.set(
      cur,
      computeBalances(
        paidByCur.get(cur) ?? [],
        owedByCur.get(cur) ?? [],
        paidSettByCur.get(cur) ?? [],
        recvSettByCur.get(cur) ?? [],
      )
    );
  }
  return out;
}
