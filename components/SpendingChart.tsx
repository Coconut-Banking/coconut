"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { formatCurrency, getCurrencySymbol } from "@/lib/currency";

function CustomTooltip({
  active,
  payload,
  label,
  currencyCode,
}: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
  currencyCode?: string;
}) {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white border border-gray-100 rounded-xl shadow-lg px-3 py-2">
        <div className="text-xs text-gray-500 mb-0.5">{label}</div>
        <div className="text-sm font-bold text-gray-900">
          {formatCurrency(payload[0].value, currencyCode)}
        </div>
      </div>
    );
  }
  return null;
}

export function SpendingChart({
  data,
  currencyCode,
}: {
  data: { month: string; amount: number }[];
  currencyCode?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={160}>
      <AreaChart data={data} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
        <defs>
          <linearGradient id="spendGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#1e2021" stopOpacity={0.15} />
            <stop offset="95%" stopColor="#1e2021" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
        <XAxis
          dataKey="month"
          tick={{ fontSize: 11, fill: "#9CA3AF" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "#9CA3AF" }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `${getCurrencySymbol(currencyCode)}${(v / 1000).toFixed(1)}k`}
        />
        <Tooltip
          content={<CustomTooltip currencyCode={currencyCode} />}
          cursor={{ stroke: "#1e2021", strokeWidth: 1, strokeDasharray: "4 4" }}
        />
        <Area
          type="monotone"
          dataKey="amount"
          stroke="#1e2021"
          strokeWidth={2}
          fill="url(#spendGrad)"
          dot={{ fill: "#1e2021", strokeWidth: 0, r: 3 }}
          activeDot={{ r: 5, fill: "#1e2021" }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
