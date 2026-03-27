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
  const currencies = new Set<string>();
  for (const r of paidRows) currencies.add(normalizeSplitCurrency(r.currency));
  for (const r of owedRows) currencies.add(normalizeSplitCurrency(r.currency));
  for (const r of paidSettlements) currencies.add(normalizeSplitCurrency(r.currency));
  for (const r of receivedSettlements) currencies.add(normalizeSplitCurrency(r.currency));

  const out = new Map<string, Map<string, MemberBalance>>();
  for (const cur of currencies) {
    const pr = paidRows
      .filter((r) => normalizeSplitCurrency(r.currency) === cur)
      .map(({ member_id, amount }) => ({ member_id, amount }));
    const or = owedRows
      .filter((r) => normalizeSplitCurrency(r.currency) === cur)
      .map(({ member_id, amount }) => ({ member_id, amount }));
    const ps = paidSettlements
      .filter((r) => normalizeSplitCurrency(r.currency) === cur)
      .map(({ payer_member_id, amount }) => ({ payer_member_id, amount }));
    const rs = receivedSettlements
      .filter((r) => normalizeSplitCurrency(r.currency) === cur)
      .map(({ receiver_member_id, amount }) => ({ receiver_member_id, amount }));
    out.set(cur, computeBalances(pr, or, ps, rs));
  }
  return out;
}
