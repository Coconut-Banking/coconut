"use client";

import type { Transaction } from "@/lib/types";

export function TransactionList({ transactions }: { transactions: Transaction[] }) {
  return (
    <ul className="divide-y divide-[var(--border)]">
      {transactions.map((t) => (
        <li key={t.id} className="py-3 flex justify-between items-center">
          <div>
            <p className="font-medium">{t.merchant}</p>
            <p className="text-sm text-[var(--muted)]">{t.category} · {t.date}</p>
          </div>
          <span className="font-mono text-[var(--red)]">−${t.amount.toFixed(2)}</span>
        </li>
      ))}
    </ul>
  );
}
