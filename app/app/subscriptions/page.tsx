"use client";

import { TrendingUp, TrendingDown, Minus, AlertTriangle, RefreshCw, X } from "lucide-react";
import { motion } from "motion/react";
import { subscriptions } from "@/lib/mockData";
import { useState } from "react";
import { useTransactions } from "@/hooks/useTransactions";
import { useDemoMode } from "@/components/AppGate";

function MerchantAvatar({ name, color }: { name: string; color: string }) {
  return (
    <div
      className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-sm font-bold shrink-0"
      style={{ backgroundColor: color }}
    >
      {name[0]}
    </div>
  );
}

export default function SubscriptionsPage() {
  const [dismissed, setDismissed] = useState<string[]>([]);
  const { linked } = useTransactions();
  const isDemo = useDemoMode();

  if (linked && !isDemo) {
    return (
      <div className="max-w-3xl mx-auto px-8 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Subscriptions</h1>
          <p className="text-sm text-gray-500 mt-1">Recurring charge detection coming soon.</p>
        </div>
        <div className="bg-gray-50 border border-gray-100 rounded-2xl p-12 text-center">
          <RefreshCw size={32} className="text-gray-300 mx-auto mb-4" />
          <p className="text-sm text-gray-500">No subscription data yet. We&apos;ll detect recurring charges from your transactions soon.</p>
        </div>
      </div>
    );
  }

  const alerts = subscriptions.filter((s) => s.alert && !dismissed.includes(s.id));
  const totalMonthly = subscriptions.reduce((acc, s) => acc + s.amount, 0);
  const totalAnnual = totalMonthly * 12;

  return (
    <div className="max-w-3xl mx-auto px-8 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Subscriptions</h1>
        <p className="text-sm text-gray-500 mt-1">
          {subscriptions.length} active · ${totalMonthly.toFixed(2)}/mo · ${totalAnnual.toFixed(0)}/yr
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <div className="text-xs text-gray-400 mb-1">Monthly</div>
          <div className="text-xl font-bold text-gray-900">${totalMonthly.toFixed(2)}</div>
          <div className="text-xs text-gray-400 mt-0.5">{subscriptions.length} subscriptions</div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <div className="text-xs text-gray-400 mb-1">Annual</div>
          <div className="text-xl font-bold text-gray-900">${totalAnnual.toFixed(0)}</div>
          <div className="text-xs text-gray-400 mt-0.5">Projected spend</div>
        </div>
        <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4">
          <div className="text-xs text-amber-600 mb-1">Alerts</div>
          <div className="text-xl font-bold text-amber-700">{alerts.length}</div>
          <div className="text-xs text-amber-600 mt-0.5">Need attention</div>
        </div>
      </div>

      {alerts.length > 0 && (
        <div className="space-y-2 mb-6">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Alerts</div>
          {alerts.map((sub) => (
            <motion.div
              key={sub.id}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: 40 }}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
                sub.alert?.includes("Duplicate")
                  ? "bg-red-50 border-red-100"
                  : "bg-amber-50 border-amber-100"
              }`}
            >
              <AlertTriangle
                size={15}
                className={sub.alert?.includes("Duplicate") ? "text-red-500 shrink-0" : "text-amber-500 shrink-0"}
              />
              <div className="flex-1">
                <span className={`text-sm font-medium ${sub.alert?.includes("Duplicate") ? "text-red-900" : "text-amber-900"}`}>
                  {sub.merchant}:
                </span>{" "}
                <span className={`text-sm ${sub.alert?.includes("Duplicate") ? "text-red-700" : "text-amber-700"}`}>
                  {sub.alert}
                </span>
              </div>
              <button
                onClick={() => setDismissed((d) => [...d, sub.id])}
                className="text-gray-400 hover:text-gray-600 p-1"
              >
                <X size={13} />
              </button>
            </motion.div>
          ))}
        </div>
      )}

      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">All Subscriptions</div>
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
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-sm font-semibold text-gray-900">{sub.merchant}</span>
                {sub.alert && (
                  <AlertTriangle
                    size={12}
                    className={sub.alert.includes("Duplicate") ? "text-red-500" : "text-amber-500"}
                  />
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">{sub.category}</span>
                <span className="text-xs text-gray-300">·</span>
                <span className="text-xs text-gray-400">Last: {sub.lastCharged}</span>
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-sm font-bold text-gray-900">${sub.amount.toFixed(2)}/mo</div>
              <div className="flex items-center justify-end gap-1 mt-0.5">
                {sub.trend === "up" && (
                  <div className="flex items-center gap-1 text-xs text-red-500">
                    <TrendingUp size={11} />
                    <span>+{sub.trendPercent}%</span>
                  </div>
                )}
                {sub.trend === "down" && (
                  <div className="flex items-center gap-1 text-xs text-[#3D8E62]">
                    <TrendingDown size={11} />
                    <span>-{sub.trendPercent}%</span>
                  </div>
                )}
                {sub.trend === "stable" && (
                  <div className="flex items-center gap-1 text-xs text-gray-400">
                    <Minus size={11} />
                    <span>Stable</span>
                  </div>
                )}
              </div>
            </div>
            <div className="shrink-0 flex gap-2">
              <button className="text-xs text-gray-400 hover:text-[#3D8E62] px-2.5 py-1.5 border border-gray-200 rounded-lg hover:border-[#3D8E62] transition-colors">
                Cancel
              </button>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="mt-6 bg-white rounded-2xl border border-gray-100 p-5">
        <div className="flex items-center gap-2 mb-4">
          <RefreshCw size={14} className="text-gray-400" />
          <span className="text-sm font-semibold text-gray-700">Yearly breakdown</span>
        </div>
        <div className="space-y-2.5">
          {subscriptions.map((sub) => {
            const pct = (sub.amount / totalMonthly) * 100;
            return (
              <div key={sub.id}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-gray-600">{sub.merchant}</span>
                  <span className="text-gray-500">${(sub.amount * 12).toFixed(2)}/yr</span>
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
    </div>
  );
}
