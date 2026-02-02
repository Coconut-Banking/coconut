"use client";

import type { Subscription } from "@/lib/types";

export function SubscriptionCards({ subscriptions }: { subscriptions: Subscription[] }) {
  const total = subscriptions.reduce((s, sub) => s + sub.amount, 0);
  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--muted)]">
        {subscriptions.length} subscriptions · ${total.toFixed(2)}/mo
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {subscriptions.slice(0, 6).map((s) => (
          <div
            key={s.id}
            className="bg-[var(--card)] border border-[var(--border)] rounded-lg p-3"
          >
            <p className="font-medium truncate">{s.name}</p>
            <p className="text-sm text-[var(--muted)]">${s.amount}/mo</p>
            <p className="text-xs text-[var(--muted)]">Due {s.nextDue}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
