"use client";

import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { TrendingDown, RefreshCw, Users, DollarSign, ArrowRight } from "lucide-react";
import { motion } from "motion/react";
import { useTransactions } from "@/hooks/useTransactions";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { AmountDisplay, MerchantLogo } from "@/components/transaction-ui";

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) => {
  if (active && payload && payload.length) {
    const val = Math.round(payload[0].value * 100) / 100;
    return (
      <div className="bg-white border border-gray-100 rounded-xl shadow-lg px-3 py-2">
        <div className="text-xs text-gray-500 mb-0.5">{label}</div>
        <div className="text-sm font-bold text-gray-900">${val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
      </div>
    );
  }
  return null;
};

/** Format currency to 2 decimals, avoid floating-point display issues */
function formatCurrency(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Derive spending by month and category from linked transactions (no demo/sandbox)
function deriveFromTransactions(transactions: { amount: number; date: string; category?: string }[]) {
  const byMonth: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  for (const tx of transactions) {
    const amt = Math.round(Math.abs(tx.amount) * 100) / 100;
    const month = tx.date.slice(0, 7);
    const [y, m] = month.split("-").map(Number);
    const monthKey = new Date(y, m - 1).toLocaleString("en", { month: "short" });
    byMonth[monthKey] = Math.round(((byMonth[monthKey] ?? 0) + amt) * 100) / 100;
    const cat = tx.category ?? "Other";
    byCategory[cat] = Math.round(((byCategory[cat] ?? 0) + amt) * 100) / 100;
  }
  const colors = ["#3D8E62", "#4A6CF7", "#9B59B6", "#E8507A", "#F59E0B", "#CBD5E1"];
  const total = Object.values(byCategory).reduce((a, b) => a + b, 0);
  const categoryData = Object.entries(byCategory)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 6)
    .map(([name, amount], i) => ({
      name,
      amount,
      color: colors[i % colors.length],
      pct: total ? Math.round((amount / total) * 100) : 0,
    }));
  const spendingData = Object.entries(byMonth)
    .sort(([a], [b]) => {
      const order = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      return order.indexOf(a) - order.indexOf(b);
    })
    .slice(-6)
    .map(([month, amount]) => ({ month, amount }));
  const thisMonth = new Date().toLocaleString("en", { month: "short" });
  const monthlySpend = byMonth[thisMonth] ?? 0;
  return { spendingData, categoryData, monthlySpend };
}

export default function DashboardPage() {
  const router = useRouter();
  const { user } = useUser();
  const { transactions, linked, loading } = useTransactions();
  const displayName = user?.firstName || user?.fullName || user?.username || user?.primaryEmailAddress?.emailAddress?.split("@")[0] || "there";
  const recentTransactions = transactions.slice(0, 5);
  const { spendingData, categoryData, monthlySpend } = deriveFromTransactions(transactions);

  if (linked && loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-8 py-8">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-[#3D8E62]/30 border-t-[#3D8E62] rounded-full animate-spin" />
          <p className="text-sm text-gray-500">Loading your data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-8 py-8 max-w-5xl mx-auto">
      {linked && (
        <div className="mb-4 flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#EEF7F2] border border-[#D1EAE0] text-[#2D7A52] text-xs font-medium px-2.5 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#3D8E62] animate-pulse" />
            Live from linked account
          </span>
        </div>
      )}
      <div className="mb-7">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Good morning, {displayName} ☀️</h1>
        <p className="text-sm text-gray-500 mt-1">
          February 2026 · <span className="text-[#3D8E62] font-medium">{transactions.length} transactions</span>
        </p>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0, duration: 0.4 }}
          className="bg-white rounded-2xl border border-gray-100 p-4"
        >
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-red-50 mb-3">
            <TrendingDown size={15} className="text-red-500" />
          </div>
          <div className="text-xl font-bold text-gray-900 mb-0.5">
            ${formatCurrency(monthlySpend)}
          </div>
          <div className="text-xs text-gray-500 mb-2">Monthly Spend</div>
          <div className="text-xs text-gray-400">From transactions</div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.07, duration: 0.4 }}
          className="bg-white rounded-2xl border border-gray-100 p-4"
        >
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-purple-50 mb-3">
            <RefreshCw size={15} className="text-purple-500" />
          </div>
          <div className="text-xl font-bold text-gray-900 mb-0.5">{linked ? "—" : "$84.95"}</div>
          <div className="text-xs text-gray-500 mb-2">Subscriptions</div>
          {linked && <div className="text-xs text-gray-400">Coming soon</div>}
          {!linked && <div className="text-xs bg-red-50 text-red-600 px-2 py-0.5 rounded-full">↑ Price alert</div>}
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.14, duration: 0.4 }}
          className="bg-white rounded-2xl border border-gray-100 p-4"
        >
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-blue-50 mb-3">
            <Users size={15} className="text-blue-500" />
          </div>
          <div className="text-xl font-bold text-gray-900 mb-0.5">—</div>
          <div className="text-xs text-gray-500 mb-2">Shared Expenses</div>
          <a href="/app/shared" className="text-xs text-[#3D8E62] hover:underline">View →</a>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.21, duration: 0.4 }}
          className="bg-white rounded-2xl border border-gray-100 p-4"
        >
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#EEF7F2] mb-3">
            <DollarSign size={15} className="text-[#3D8E62]" />
          </div>
          <div className="text-xl font-bold text-gray-900 mb-0.5">—</div>
          <div className="text-xs text-gray-500 mb-2">Net Cash Flow</div>
          <div className="text-xs text-gray-400">Coming soon</div>
        </motion.div>
      </div>

      <div className="grid grid-cols-5 gap-4 mb-6">
        <div className="col-span-3 bg-white rounded-2xl border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-sm font-semibold text-gray-900">Monthly Spending</div>
              <div className="text-xs text-gray-400 mt-0.5">Last 6 months</div>
            </div>
            <div className="flex items-center gap-1 text-xs text-gray-400">
              <div className="w-2 h-2 rounded-full bg-[#3D8E62]" />
              Spend
            </div>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            {spendingData.length > 0 ? (
            <AreaChart data={spendingData} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
              <defs>
                <linearGradient id="spendGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3D8E62" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#3D8E62" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#9CA3AF" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#9CA3AF" }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`} />
              <Tooltip content={<CustomTooltip />} cursor={{ stroke: "#3D8E62", strokeWidth: 1, strokeDasharray: "4 4" }} />
              <Area
                type="monotone"
                dataKey="amount"
                stroke="#3D8E62"
                strokeWidth={2}
                fill="url(#spendGrad)"
                dot={{ fill: "#3D8E62", strokeWidth: 0, r: 3 }}
                activeDot={{ r: 5, fill: "#3D8E62" }}
              />
            </AreaChart>
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-gray-400">No spending data yet</div>
            )}
          </ResponsiveContainer>
        </div>

        <div className="col-span-2 bg-white rounded-2xl border border-gray-100 p-5">
          <div className="text-sm font-semibold text-gray-900 mb-1">Top Categories</div>
          <div className="text-xs text-gray-400 mb-4">From your transactions</div>
          <div className="space-y-3">
            {categoryData.length > 0 ? categoryData.map((cat) => (
              <div key={cat.name}>
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="text-gray-600">{cat.name}</span>
                  <span className="text-gray-500 font-medium">${formatCurrency(cat.amount)}</span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${cat.pct}%` }}
                    transition={{ duration: 0.7, delay: 0.3 }}
                    className="h-full rounded-full"
                    style={{ backgroundColor: cat.color }}
                  />
                </div>
              </div>
            )) : (
              <div className="py-6 text-center text-sm text-gray-400">No category data yet</div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-4">
        <div className="col-span-3 bg-white rounded-2xl border border-gray-100">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <div>
              <div className="text-sm font-semibold text-gray-900">Recent Transactions</div>
              <div className="text-xs text-gray-400 mt-0.5">Names auto-normalized</div>
            </div>
            <button
              onClick={() => router.push("/app/transactions")}
              className="flex items-center gap-1 text-xs text-[#3D8E62] font-medium hover:underline"
            >
              View all <ArrowRight size={11} />
            </button>
          </div>
          {recentTransactions.map((tx, i) => (
            <motion.div
              key={tx.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.1 + i * 0.05 }}
              onClick={() => router.push("/app/transactions")}
              className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors cursor-pointer border-b border-gray-50 last:border-b-0"
            >
                    <MerchantLogo name={tx.merchant} color={tx.merchantColor} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-medium text-gray-900">{tx.merchant}</span>
                  {tx.isRecurring && <RefreshCw size={10} className="text-gray-300" />}
                  {tx.hasSplitSuggestion && (
                    <div className="flex items-center gap-1 bg-[#EEF7F2] text-[#3D8E62] text-xs px-1.5 py-0.5 rounded-full">
                      <Users size={8} />
                      <span>Split</span>
                    </div>
                  )}
                </div>
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${tx.categoryColor}`}>{tx.category}</span>
              </div>
              <div className="text-right shrink-0">
                <AmountDisplay amount={tx.amount} className="text-sm" />
                <div className="text-xs text-gray-400">{tx.dateStr}</div>
              </div>
            </motion.div>
          ))}
        </div>

        <div className="col-span-2 space-y-3">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-1">Smart Insights</div>
          <div className="bg-gray-50 border border-gray-100 rounded-2xl p-6 text-center">
            <p className="text-sm text-gray-500">Subscription alerts, split reminders, and duplicate detection coming soon.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
