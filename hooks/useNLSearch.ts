"use client";

import { useState, useEffect, useRef } from "react";

interface TxLike { id: string; merchant: string; amount: number; date: string; category: string }

const DEBOUNCE_MS = 500;

export function useNLSearch<T extends TxLike>(
  query: string,
  transactions: T[]
): { results: T[]; answer: string; loading: boolean } {
  const [results, setResults] = useState<T[]>([]);
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(transactions);
      setAnswer("");
      setLoading(false);
      return;
    }
    setResults([]);
    setAnswer("");
    setLoading(true);

    debounceRef.current = setTimeout(async () => {
      if (transactions.length === 0) {
        setResults([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const res = await fetch("/api/nl-search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            q,
            transactions: transactions.map((t) => ({
              id: t.id,
              merchant: t.merchant,
              amount: t.amount,
              date: t.date,
              category: t.category,
            })),
          }),
        });
        const data = await res.json();
        const ids = data?.ids ?? [];
        const ans = data?.answer ?? "";
        const ordered = ids
          .map((id: string) => transactions.find((t) => t.id === id))
          .filter(Boolean) as T[];
        setResults(ordered);
        setAnswer(ans);
      } catch {
        setResults(transactions);
        setAnswer("");
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, transactions]);

  return {
    results: query.trim() ? results : transactions,
    answer: query.trim() ? answer : "",
    loading: query.trim() ? loading : false,
  };
}
