"use client";

import { useState, useEffect } from "react";
import { transactions as mockTransactions } from "@/lib/mockData";
import type { Transaction } from "@/lib/mockData";

const DEMO_KEY = "coconut_demo";

function isDemoMode(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(DEMO_KEY) === "true";
}

export function useTransactions() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [linked, setLinked] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/plaid/status")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (!data.linked) {
          if (isDemoMode()) {
            setTransactions(mockTransactions);
          }
          setLoading(false);
          return;
        }
        setLinked(true);
        return fetch("/api/plaid/transactions");
      })
      .then((res) => {
        if (!res || cancelled) return res?.json?.();
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        if (Array.isArray(data)) {
          setTransactions(data as Transaction[]);
        }
      })
      .catch(() => {
        if (!cancelled && isDemoMode()) setTransactions(mockTransactions);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  return { transactions, linked, loading };
}
