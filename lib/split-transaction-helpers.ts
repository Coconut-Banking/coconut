/**
 * Helpers for split_transactions rows — bank-linked splits vs Splitwise/manual (no transaction_id).
 */

type TxJoin =
  | { merchant_name?: string | null; raw_name?: string | null; amount?: number | null }
  | { merchant_name?: string | null; raw_name?: string | null; amount?: number | null }[]
  | null
  | undefined;

function asTxJoin(v: unknown): TxJoin {
  return v as TxJoin;
}

/** Bank-linked rows share transaction_id; Splitwise rows use null and must each be counted separately. */
export function splitTransactionDedupeKey(row: { id: string; transaction_id?: string | null }): string {
  if (row.transaction_id != null && String(row.transaction_id) !== "") {
    return `tx:${row.transaction_id}`;
  }
  return `split:${row.id}`;
}

export function paidAmountFromSplitRow(s: {
  transactions?: unknown;
  amount?: number | string | null;
}): number {
  const tx = asTxJoin(s.transactions);
  const fromTx = Number(Array.isArray(tx) ? tx[0]?.amount : tx?.amount);
  if (Number.isFinite(fromTx) && fromTx !== 0) {
    return Math.abs(fromTx);
  }
  const n = s.amount == null ? NaN : Number(s.amount);
  return Number.isFinite(n) ? Math.abs(n) : 0;
}

export function merchantLabelFromSplitRow(s: {
  transactions?: unknown;
  description?: string | null;
}): string {
  const tx = asTxJoin(s.transactions);
  const row = Array.isArray(tx) ? tx[0] : tx;
  const name = row?.merchant_name ?? row?.raw_name;
  if (name != null && String(name).trim() !== "") return String(name).trim();
  if (s.description != null && String(s.description).trim() !== "") return String(s.description).trim();
  return "Expense";
}
