"use client";

import { useState, useEffect } from "react";
import type { UITransaction } from "@/lib/transaction-types";

export type Transaction = UITransaction;

export function useTransactions() {
  const [transactions, setTransactions] = useState<UITransaction[]>([]);
  const [linked, setLinked] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/plaid/status")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (!data.linked) {
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
          setTransactions(data as UITransaction[]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  return { transactions, linked, loading };
}
