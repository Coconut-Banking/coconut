"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import {
  TrendingDown, TrendingUp, RefreshCw, Users, DollarSign, ArrowRight,
  Wallet, CalendarClock, ArrowUpRight, ArrowDownRight, CreditCard, Building2, Sparkles,
} from "lucide-react";
import { motion } from "motion/react";
import { useTransactions } from "@/hooks/useTransactions";
import { useGroupsSummary } from "@/hooks/useGroups";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { AmountDisplay, MerchantLogo } from "@/components/transaction-ui";
import { formatCurrency, getCurrencySymbol } from "@/lib/currency";
import { useCurrency, useManualMonthlyIncome } from "@/hooks/useCurrency";

function CustomTooltip({ active, payload, label, currencyCode }: { active?: boolean; payload?: { value: number }[]; label?: string; currencyCode?: string }) {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white border border-gray-100 rounded-xl shadow-lg px-3 py-2">
        <div className="text-xs text-gray-500 mb-0.5">{label}</div>
        <div className="text-sm font-bold text-gray-900">{formatCurrency(payload[0].value, currencyCode)}</div>
      </div>
    );
  }
  return null;
}

interface DashboardData {
  netWorth: { assets: number; liabilities: number; total: number };
  subscriptions: {
    totalMonthly: number;
    count: number;
    upcomingBills: Array<{ merchant: string; amount: number; nextDue: string; category: string }>;
  };
  accounts: Array<{
    name: string;
    type: string;
    subtype: string | null;
    mask: string | null;
    balance: number;
    isLiability: boolean;
    iso_currency_code: string;
  }>;
}

interface MonthStats {
  income: number;
  expenses: number;
  net: number;
}

interface CategoryDelta {
  name: string;
  current: number;
  previous: number;
  delta: number;
  pct: number;
  color: string;
}

interface TopMerchant {
  name: string;
  total: number;
  count: number;
  color: string;
}

function deriveFromTransactions(transactions: { amount: number; date: string; category?: string; merchant?: string }[]) {
  // Spending metrics use ONLY expenses (negative amounts).
  // Plaid convention in Coconut: negative = expense, positive = income.
  const spendByMonth: Record<string, number> = {};
  const spendByCategory: Record<string, number> = {};
  const now = new Date();
  const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthKey = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;

  let thisMonthIncome = 0;
  let thisMonthExpenses = 0;

  const catByMonth: Record<string, Record<string, number>> = {};
  const merchantTotals: Record<string, { total: number; count: number }> = {};

  for (const tx of transactions) {
    const absAmt = Math.round(Math.abs(tx.amount) * 100) / 100;
    const month = tx.date.slice(0, 7);
    const cat = (tx.category ?? "").toUpperCase().replace(/\s/g, "_");
    const isIncomeCategory = ["INCOME", "TRANSFER_IN"].includes(cat);
    // Plaid: negative = credit (income), positive = debit (expense). Defensive: some banks may report differently.
    const isExpense = isIncomeCategory ? false : tx.amount < 0;

    // Cash flow: track income and expenses separately for current month
    if (month === thisMonthKey) {
      if (isExpense) thisMonthExpenses += absAmt;
      else thisMonthIncome += absAmt;
    }

    // All spending metrics: expenses only
    if (isExpense) {
      // Spending by month (for chart) — key by YYYY-MM for correct chronological sorting
      spendByMonth[month] = Math.round(((spendByMonth[month] ?? 0) + absAmt) * 100) / 100;

      const cat = tx.category ?? "Other";
      spendByCategory[cat] = Math.round(((spendByCategory[cat] ?? 0) + absAmt) * 100) / 100;

      // Category by month (for month-over-month deltas)
      if (month === thisMonthKey || month === prevMonthKey) {
        if (!catByMonth[cat]) catByMonth[cat] = {};
        catByMonth[cat][month] = (catByMonth[cat][month] ?? 0) + absAmt;
      }

      // Top merchants
      if (tx.merchant) {
        if (!merchantTotals[tx.merchant]) merchantTotals[tx.merchant] = { total: 0, count: 0 };
        merchantTotals[tx.merchant].total += absAmt;
        merchantTotals[tx.merchant].count++;
      }
    }
  }

  const colors = ["#3D8E62", "#4A6CF7", "#9B59B6", "#E8507A", "#F59E0B", "#CBD5E1"];
  const total = Object.values(spendByCategory).reduce((a, b) => a + b, 0);
  const categoryData = Object.entries(spendByCategory)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 6)
    .map(([name, amount], i) => ({
      name,
      amount,
      color: colors[i % colors.length],
      pct: total ? Math.round((amount / total) * 100) : 0,
    }));

  // Sort by YYYY-MM key (chronological), then display as short month name
  const spendingData = Object.entries(spendByMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6)
    .map(([ym, amount]) => {
      const [y, m] = ym.split("-").map(Number);
      return { month: new Date(y, m - 1).toLocaleString("en", { month: "short" }), amount };
    });

  const monthlySpend = spendByMonth[thisMonthKey] ?? 0;

  const cashFlow: MonthStats = {
    income: thisMonthIncome,
    expenses: thisMonthExpenses,
    net: thisMonthIncome - thisMonthExpenses,
  };

  const categoryDeltas: CategoryDelta[] = Object.entries(catByMonth)
    .map(([name, months], i) => {
      const current = months[thisMonthKey] ?? 0;
      const previous = months[prevMonthKey] ?? 0;
      const delta = current - previous;
      const pct = previous > 0 ? Math.round((delta / previous) * 100) : current > 0 ? 100 : 0;
      return { name, current, previous, delta, pct, color: colors[i % colors.length] };
    })
    .filter((d) => d.current > 0 || d.previous > 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 5);

  const topMerchants: TopMerchant[] = Object.entries(merchantTotals)
    .sort(([, a], [, b]) => b.total - a.total)
    .slice(0, 5)
    .map(([name, data], i) => ({
      name,
      total: data.total,
      count: data.count,
      color: colors[i % colors.length],
    }));

  return { spendingData, categoryData, monthlySpend, cashFlow, categoryDeltas, topMerchants };
}

export default function DashboardPage() {
  const router = useRouter();
  const { user } = useUser();
  const { transactions, linked, loading } = useTransactions();
  const { summary: groupsSummary } = useGroupsSummary();
  const { currencyCode, format: fc } = useCurrency();
  const { manualMonthlyIncome } = useManualMonthlyIncome();
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);

  const displayName = user?.firstName || user?.fullName || user?.username || user?.primaryEmailAddress?.emailAddress?.split("@")[0] || "there";
  const recentTransactions = transactions.slice(0, 15);
  const base = deriveFromTransactions(transactions);
  const cashFlow = {
    ...base.cashFlow,
    income: base.cashFlow.income + manualMonthlyIncome,
    net: base.cashFlow.net + manualMonthlyIncome,
  };
  const { spendingData, categoryData, monthlySpend, categoryDeltas, topMerchants } = base;

  useEffect(() => {
    if (!linked) return;
    fetch("/api/dashboard")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setDashboard(data); })
      .catch(() => {});
  }, [linked, currencyCode]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-8 py-8">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-[#3D8E62]/30 border-t-[#3D8E62] rounded-full animate-spin" />
          <p className="text-sm text-gray-500">Loading your data...</p>
        </div>
      </div>
    );
  }

  const netWorth = dashboard?.netWorth;
  const subData = dashboard?.subscriptions;

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
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
          {new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 17 ? "Good afternoon" : "Good evening"}, {displayName}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {new Date().toLocaleString("en", { month: "long", year: "numeric" })} · <span className="text-[#3D8E62] font-medium">{transactions.length} transactions</span>
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
        {/* Monthly Spend */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 }} className="bg-white rounded-2xl border border-gray-100 p-4">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-red-50 mb-3">
            <TrendingDown size={15} className="text-red-500" />
          </div>
          <div className="text-xl font-bold text-gray-900 mb-0.5">{fc(monthlySpend)}</div>
          <div className="text-xs text-gray-500 mb-2">Monthly Spend</div>
          <div className="text-xs text-gray-400">
            {linked ? "From transactions" : "Connect a bank to see"}
          </div>
        </motion.div>

        {/* Net Cash Flow */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="bg-white rounded-2xl border border-gray-100 p-4">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#EEF7F2] mb-3">
            <DollarSign size={15} className="text-[#3D8E62]" />
          </div>
          <div className={`text-xl font-bold mb-0.5 ${cashFlow.net >= 0 ? "text-[#3D8E62]" : "text-red-500"}`}>
            {linked ? `${cashFlow.net >= 0 ? "+" : ""}${fc(cashFlow.net)}` : "—"}
          </div>
          <div className="text-xs text-gray-500 mb-2">Net Cash Flow</div>
          <div className="text-xs text-gray-400">
            {linked ? `${fc(cashFlow.income)} in · ${fc(cashFlow.expenses)} out` : "Connect a bank to see"}
          </div>
        </motion.div>

        {/* Subscriptions */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-white rounded-2xl border border-gray-100 p-4">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-purple-50 mb-3">
            <RefreshCw size={15} className="text-purple-500" />
          </div>
          <div className="text-xl font-bold text-gray-900 mb-0.5">
            {!linked ? "—" : subData ? fc(subData.totalMonthly) : "…"}
          </div>
          <div className="text-xs text-gray-500 mb-2">Subscriptions/mo</div>
          {!linked ? (
            <div className="text-xs text-gray-400">Connect a bank to see</div>
          ) : subData ? (
            <a href="/app/subscriptions" className="text-xs text-[#3D8E62] hover:underline">
              {subData.count === 0 ? "No subscriptions detected yet" : `${subData.count} active`} →
            </a>
          ) : (
            <div className="text-xs text-gray-400">Loading...</div>
          )}
        </motion.div>

        {/* Shared expenses */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="bg-white rounded-2xl border border-gray-100 p-4">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-amber-50 mb-3">
            <Users size={15} className="text-amber-600" />
          </div>
          <div className="text-xl font-bold mb-0.5">
            {groupsSummary
              ? groupsSummary.totalOwedToMe > 0
                ? fc(groupsSummary.totalOwedToMe)
                : groupsSummary.totalIOwe > 0
                  ? `−${fc(groupsSummary.totalIOwe)}`
                  : fc(0)
              : "—"}
          </div>
          <div className="text-xs text-gray-500 mb-2">Shared</div>
          {groupsSummary ? (
            <a href="/app/shared" className="text-xs text-[#3D8E62] hover:underline">
              {(groupsSummary.groups?.length ?? 0) === 0
                ? "Create a group →"
                : groupsSummary.totalOwedToMe > 0
                  ? "You're owed →"
                  : groupsSummary.totalIOwe > 0
                    ? "You owe →"
                    : "All settled →"}
            </a>
          ) : (
            <div className="text-xs text-gray-400">Loading...</div>
          )}
        </motion.div>

        {/* Net Worth */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="bg-white rounded-2xl border border-gray-100 p-4">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-blue-50 mb-3">
            <Wallet size={15} className="text-blue-500" />
          </div>
          <div className="text-xl font-bold text-gray-900 mb-0.5">
            {!linked ? "—" : netWorth != null ? fc(netWorth.total) : "…"}
          </div>
          <div className="text-xs text-gray-500 mb-2">Net Worth</div>
          {!linked ? (
            <div className="text-xs text-gray-400">Connect a bank to see</div>
          ) : netWorth != null ? (
            <div className="text-xs text-gray-400">{fc(netWorth.assets)} assets</div>
          ) : (
            <div className="text-xs text-gray-400">Loading...</div>
          )}
        </motion.div>
      </div>

      {/* Accounts */}
      {dashboard?.accounts && dashboard.accounts.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.28 }}
          className="bg-white rounded-2xl border border-gray-100 p-5 mb-6"
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-sm font-semibold text-gray-900">Accounts</div>
              <div className="text-xs text-gray-400 mt-0.5">Live balances from your bank</div>
            </div>
            <a href="/app/settings" className="text-xs text-[#3D8E62] font-medium hover:underline">Manage →</a>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {dashboard.accounts.map((acct, i) => {
              const isCredit = acct.isLiability;
              const subLabel = acct.subtype
                ? acct.subtype.replace(/_/g, " ")
                : acct.type.replace(/_/g, " ");
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 + i * 0.04 }}
                  className="flex items-start gap-3 p-3.5 rounded-xl border border-gray-100 bg-gray-50/60"
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isCredit ? "bg-red-50" : "bg-[#EEF7F2]"}`}>
                    {isCredit
                      ? <CreditCard size={14} className="text-red-400" />
                      : <Building2 size={14} className="text-[#3D8E62]" />
                    }
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-gray-800 truncate leading-tight">{acct.name}</div>
                    <div className="text-xs text-gray-400 capitalize mt-0.5">{subLabel}{acct.mask ? ` ••${acct.mask}` : ""}</div>
                    <div className={`text-sm font-semibold mt-1 ${isCredit ? "text-red-500" : "text-gray-900"}`}>
                      {isCredit ? "-" : ""}{formatCurrency(acct.balance, acct.iso_currency_code)}
                    </div>
                    {isCredit && (
                      <div className="text-xs text-gray-400 mt-0.5">balance owed</div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* Charts Row */}
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
              <YAxis tick={{ fontSize: 11, fill: "#9CA3AF" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${getCurrencySymbol(currencyCode)}${(v / 1000).toFixed(1)}k`} />
              <Tooltip content={<CustomTooltip currencyCode={currencyCode} />} cursor={{ stroke: "#3D8E62", strokeWidth: 1, strokeDasharray: "4 4" }} />
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
                  <span className="text-gray-500 font-medium">{fc(cat.amount)}</span>
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

      {/* Bottom Row: Transactions + Insights */}
      <div className="grid grid-cols-5 gap-4">
        {/* Recent Transactions */}
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
          {recentTransactions.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <p className="text-sm text-gray-500 mb-2">
                {linked ? "No transactions yet" : "Link a bank to see transactions"}
              </p>
              <button
                onClick={() => router.push(linked ? "/app/transactions" : "/app/settings")}
                className="text-sm text-[#3D8E62] font-medium hover:underline"
              >
                {linked ? "View transactions" : "Connect bank in Settings"}
              </button>
            </div>
          ) : recentTransactions.map((tx, i) => (
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
                  {tx.isRecurring && <RefreshCw size={10} className="text-purple-400" />}
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
                <AmountDisplay
                    amount={tx.amount}
                    className="text-sm"
                    currencyCode={currencyCode}
                    isoCurrencyCode={tx.isoCurrencyCode}
                    category={tx.category}
                    merchant={tx.merchant}
                    rawDescription={tx.rawDescription}
                  />
                <div className="text-xs text-gray-400">{tx.dateStr}</div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Right Column: Insights */}
        <div className="col-span-2 space-y-4">
          {/* Smart Insights (1–2 real insights or fallback) */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles size={14} className="text-[#3D8E62]" />
              <div className="text-sm font-semibold text-gray-900">Smart Insights</div>
            </div>
            <div className="space-y-2">
              {linked && categoryDeltas.length > 0 && (
                <p className="text-sm text-gray-700">
                  <span className="font-medium">{categoryDeltas[0].name}</span>{" "}
                  {categoryDeltas[0].delta > 0 ? "up" : "down"}{" "}
                  <span className={categoryDeltas[0].delta > 0 ? "text-red-500" : "text-[#3D8E62]"}>
                    {Math.abs(categoryDeltas[0].pct)}%
                  </span>{" "}
                  vs last month
                </p>
              )}
              {groupsSummary?.friends?.some((f) => f.balance > 0) && (
                <p className="text-sm text-gray-700">
                  <span className="font-medium">{groupsSummary.friends.find((f) => f.balance > 0)?.displayName}</span> owes you{" "}
                  <span className="text-[#3D8E62] font-medium">
                    {fc(groupsSummary.friends.find((f) => f.balance > 0)?.balance ?? 0)}
                  </span>
                </p>
              )}
              {groupsSummary && groupsSummary.totalIOwe > 0 && !groupsSummary.friends?.some((f) => f.balance > 0) && (
                <p className="text-sm text-gray-700">
                  You owe <span className="text-red-500 font-medium">{fc(groupsSummary.totalIOwe)}</span> across groups
                </p>
              )}
              {(!linked || (categoryDeltas.length === 0 && !groupsSummary?.friends?.some((f) => f.balance > 0) && (groupsSummary?.totalIOwe ?? 0) <= 0)) && (
                <p className="text-sm text-gray-500">Connect accounts and sync to see insights.</p>
              )}
            </div>
          </div>

          {/* Upcoming Bills */}
          {subData && subData.upcomingBills.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 p-5">
              <div className="flex items-center gap-2 mb-3">
                <CalendarClock size={14} className="text-purple-500" />
                <div className="text-sm font-semibold text-gray-900">Upcoming Bills</div>
              </div>
              <div className="space-y-2.5">
                {subData.upcomingBills.map((bill, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <div>
                      <div className="text-sm text-gray-900">{bill.merchant}</div>
                      <div className="text-xs text-gray-400">
                        {bill.nextDue ? new Date(bill.nextDue + "T12:00:00").toLocaleDateString("en", { month: "short", day: "numeric" }) : "—"}
                      </div>
                    </div>
                    <div className="text-sm font-medium text-gray-900">{fc(bill.amount)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Month-over-Month */}
          {categoryDeltas.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 p-5">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp size={14} className="text-[#3D8E62]" />
                <div className="text-sm font-semibold text-gray-900">vs. Last Month</div>
              </div>
              <div className="space-y-2.5">
                {categoryDeltas.map((d) => (
                  <div key={d.name} className="flex items-center justify-between">
                    <div className="text-sm text-gray-700">{d.name}</div>
                    <div className={`flex items-center gap-1 text-xs font-medium ${d.delta > 0 ? "text-red-500" : d.delta < 0 ? "text-[#3D8E62]" : "text-gray-400"}`}>
                      {d.delta > 0 ? <ArrowUpRight size={12} /> : d.delta < 0 ? <ArrowDownRight size={12} /> : null}
                      {d.pct !== 0 ? `${d.pct > 0 ? "+" : ""}${d.pct}%` : "same"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top Merchants */}
          {topMerchants.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 p-5">
              <div className="flex items-center gap-2 mb-3">
                <DollarSign size={14} className="text-[#4A6CF7]" />
                <div className="text-sm font-semibold text-gray-900">Top Merchants</div>
              </div>
              <div className="space-y-2.5">
                {topMerchants.map((m, i) => (
                  <div key={m.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-gray-400 w-4">{i + 1}</span>
                      <span className="text-sm text-gray-900">{m.name}</span>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-medium text-gray-900">{fc(m.total)}</div>
                      <div className="text-xs text-gray-400">{m.count} txn{m.count !== 1 ? "s" : ""}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
