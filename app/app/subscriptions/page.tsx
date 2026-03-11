"use client";

import { RefreshCw } from "lucide-react";
import { motion } from "motion/react";
import { useSubscriptions } from "@/hooks/useSubscriptions";

function MerchantAvatar({ name, color }: { name: string; color: string }) {
  return (
    <div
      className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-sm font-bold shrink-0"
      style={{ backgroundColor: color }}
    >
      {name ? name[0] : "?"}
    </div>
  );
}

export default function SubscriptionsPage() {
  const { subscriptions, totalMonthly, totalAnnual, loading, detecting, detect, dismiss } = useSubscriptions();

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-8 py-8">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Subscriptions</h1>
        <div className="mt-6 bg-gray-50 border border-gray-100 rounded-2xl p-12 text-center text-gray-500">
          Loading…
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-8 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Subscriptions</h1>
        <p className="text-sm text-gray-500 mt-1">
          {subscriptions.length} active · ${totalMonthly.toFixed(2)}/mo · ${totalAnnual.toFixed(0)}/yr
        </p>
      </div>
      <button
        onClick={detect}
        disabled={detecting || loading}
        className="mb-6 px-4 py-2.5 bg-[#3D8E62] text-white rounded-xl text-sm font-medium hover:bg-[#2d7a4a] disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
      >
        <RefreshCw size={16} className={detecting ? "animate-spin" : ""} />
        {detecting ? "Detecting…" : "Detect subscriptions"}
      </button>
      {subscriptions.length === 0 ? (
        <div className="bg-gray-50 border border-gray-100 rounded-2xl p-12 text-center">
          <RefreshCw size={32} className="text-gray-300 mx-auto mb-4" />
          <p className="text-sm text-gray-500 mb-4">No subscriptions detected yet.</p>
          <p className="text-xs text-gray-400">
            Connect your bank, sync transactions, then tap &quot;Detect subscriptions&quot; to find recurring charges from streaming, software, gyms, and similar services.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-white rounded-2xl border border-gray-100 p-4">
              <div className="text-xs text-gray-400 mb-1">Monthly</div>
              <div className="text-xl font-bold text-gray-900">${totalMonthly.toFixed(2)}</div>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 p-4">
              <div className="text-xs text-gray-400 mb-1">Annual</div>
              <div className="text-xl font-bold text-gray-900">${totalAnnual.toFixed(0)}</div>
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            {subscriptions.map((sub, i) => (
              <motion.div
                key={sub.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.06 }}
                className="flex items-center gap-4 px-5 py-4 border-b border-gray-50 last:border-b-0 hover:bg-gray-50 transition-colors"
              >
                <MerchantAvatar name={sub.merchant} color={sub.merchantColor} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-900">{sub.merchant}</div>
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    {sub.category ?? "—"} · Last: {sub.lastChargedStr ?? "—"}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-bold text-gray-900">
                    ${sub.amount.toFixed(2)}/{sub.frequency === "yearly" ? "yr" : "mo"}
                  </div>
                </div>
                <button
                  onClick={() => dismiss(sub.id)}
                  className="text-xs text-gray-400 hover:text-red-600 px-2.5 py-1.5 border border-gray-200 rounded-lg hover:border-red-300 transition-colors"
                >
                  Dismiss
                </button>
              </motion.div>
            ))}
          </div>
          {totalMonthly > 0 && (
            <div className="mt-6 bg-white rounded-2xl border border-gray-100 p-5">
              <div className="flex items-center gap-2 mb-4">
                <RefreshCw size={14} className="text-gray-400" />
                <span className="text-sm font-semibold text-gray-700">Yearly breakdown</span>
              </div>
              <div className="space-y-2.5">
                {subscriptions.map((sub) => {
                  const monthly =
                    sub.frequency === "monthly" ? sub.amount
                    : sub.frequency === "yearly" ? sub.amount / 12
                    : sub.frequency === "weekly" ? sub.amount * 4.33
                    : sub.frequency === "biweekly" ? sub.amount * 2.17
                    : sub.amount;
                  const yearly =
                    sub.frequency === "yearly" ? sub.amount
                    : sub.frequency === "monthly" ? sub.amount * 12
                    : sub.frequency === "weekly" ? sub.amount * 52
                    : sub.frequency === "biweekly" ? sub.amount * 26
                    : sub.amount * 12;
                  const pct = totalMonthly > 0 ? (monthly / totalMonthly) * 100 : 0;
                  return (
                    <div key={sub.id}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-gray-600">{sub.merchant}</span>
                        <span className="text-gray-500">${yearly.toFixed(2)}/yr</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.8, delay: 0.2 }}
                          className="h-full rounded-full bg-[#3D8E62]"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
