"use client";

import { useState, useEffect, useRef } from "react";
import type { Transaction } from "@/lib/mockData";

const DEBOUNCE_MS = 500;

interface SearchResponse {
  transactions: Array<{
    id: string;
    plaid_transaction_id: string;
    merchant_name: string | null;
    raw_name: string | null;
    amount: number;
    date: string;
    primary_category: string | null;
    detailed_category: string | null;
  }>;
  answer: string;
  metric: string;
  total: number | null;
  count: number | null;
  breakdown: Array<{ category: string; total: number; count: number }> | null;
  usedVectorFallback: boolean;
}

// Map DB transaction row to UI Transaction shape
function toUITransaction(t: SearchResponse["transactions"][number]): Transaction {
  const CATEGORY_COLORS: Record<string, string> = {
    ENTERTAINMENT: "bg-purple-100 text-purple-700",
    RESTAURANTS: "bg-orange-100 text-orange-700",
    GROCERIES: "bg-emerald-100 text-emerald-700",
    TRAVEL: "bg-cyan-100 text-cyan-700",
    TRANSPORTATION: "bg-blue-100 text-blue-700",
    SHOPPING: "bg-amber-100 text-amber-700",
    GENERAL_MERCHANDISE: "bg-amber-100 text-amber-700",
    UTILITIES: "bg-gray-100 text-gray-700",
    RENT_AND_UTILITIES: "bg-gray-100 text-gray-700",
    HEALTHCARE: "bg-pink-100 text-pink-700",
    PERSONAL_CARE: "bg-indigo-100 text-indigo-700",
    GENERAL_SERVICES: "bg-slate-100 text-slate-700",
    FOOD_AND_DRINK: "bg-orange-100 text-orange-700",
    HOME_IMPROVEMENT: "bg-teal-100 text-teal-700",
  };
  const MERCHANT_COLORS = [
    "#E50914","#1DB954","#00674B","#FF9900","#003366","#7BB848","#555555",
    "#4A6CF7","#E8507A","#F59E0B","#10A37F","#FF5A5F","#1A1A1A","#4A90D9",
  ];
  function hashColor(s: string) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
    return MERCHANT_COLORS[Math.abs(h) % MERCHANT_COLORS.length];
  }
  function fmtDate(d: string) {
    const dt = new Date(d + "T12:00:00");
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${months[dt.getMonth()]} ${dt.getDate()}`;
  }
  const primary = t.primary_category ?? "OTHER";
  const merchant = t.merchant_name || t.raw_name || "Unknown";
  return {
    id: t.plaid_transaction_id,
    merchant,
    rawDescription: t.raw_name || "",
    amount: t.amount,
    category: primary.replace(/_/g, " "),
    categoryColor: CATEGORY_COLORS[primary] ?? "bg-gray-100 text-gray-700",
    date: t.date,
    dateStr: fmtDate(t.date),
    isRecurring: false,
    hasSplitSuggestion: false,
    merchantColor: hashColor(merchant),
  } as Transaction;
}

export function useNLSearch<T extends Transaction>(
  query: string,
  fallbackTransactions: T[]
): {
  results: T[];
  answer: string;
  metric: string;
  total: number | null;
  breakdown: SearchResponse["breakdown"];
  loading: boolean;
  usedVectorFallback: boolean;
} {
  const [results, setResults] = useState<T[]>([]);
  const [answer, setAnswer] = useState("");
  const [metric, setMetric] = useState("list");
  const [total, setTotal] = useState<number | null>(null);
  const [breakdown, setBreakdown] = useState<SearchResponse["breakdown"]>(null);
  const [loading, setLoading] = useState(false);
  const [usedVectorFallback, setUsedVectorFallback] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(fallbackTransactions);
      setAnswer("");
      setMetric("list");
      setTotal(null);
      setBreakdown(null);
      setLoading(false);
      setUsedVectorFallback(false);
      return;
    }

    setLoading(true);
    clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/nl-search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ q }),
        });
        const data: SearchResponse = await res.json();

        const mapped = (data.transactions ?? []).map(toUITransaction) as T[];
        setResults(mapped);
        setAnswer(data.answer ?? "");
        setMetric(data.metric ?? "list");
        setTotal(data.total ?? null);
        setBreakdown(data.breakdown ?? null);
        setUsedVectorFallback(data.usedVectorFallback ?? false);
      } catch {
        setResults(fallbackTransactions);
        setAnswer("");
        setMetric("list");
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(debounceRef.current);
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  const active = query.trim().length > 0;
  return {
    results: active ? results : fallbackTransactions,
    answer: active ? answer : "",
    metric: active ? metric : "list",
    total: active ? total : null,
    breakdown: active ? breakdown : null,
    loading: active ? loading : false,
    usedVectorFallback: active ? usedVectorFallback : false,
  };
}
