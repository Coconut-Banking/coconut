"use client";

import { useState, useEffect, useRef } from "react";
import type { UITransaction } from "@/lib/transaction-types";
import { hashColor } from "@/lib/plaid-mappers";

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

// Import from shared source so NL search results use the same colors
import { CATEGORY_COLORS } from "@/lib/plaid-mappers";

function fmtDateShort(d: string) {
  const dt = new Date(d + "T12:00:00");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[dt.getMonth()]} ${dt.getDate()}`;
}

function toUITransaction(t: SearchResponse["transactions"][number]): UITransaction {
  const primary = t.primary_category ?? "OTHER";
  const merchant = t.merchant_name || t.raw_name || "Unknown";
  return {
    id: t.plaid_transaction_id,
    dbId: t.id,
    merchant,
    rawDescription: t.raw_name || "",
    amount: t.amount,
    category: primary.replace(/_/g, " "),
    categoryColor: CATEGORY_COLORS[primary] ?? "bg-gray-100 text-gray-700",
    date: t.date,
    dateStr: fmtDateShort(t.date),
    isRecurring: false,
    hasSplitSuggestion: false,
    merchantColor: hashColor(merchant),
  } as UITransaction;
}

export function useNLSearch<T extends UITransaction>(
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
