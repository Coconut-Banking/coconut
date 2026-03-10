"use client";

import { useState, useEffect, useCallback } from "react";
import type { UITransaction } from "@/lib/transaction-types";

export type Transaction = UITransaction;

export function useTransactions() {
  const [transactions, setTransactions] = useState<UITransaction[]>([]);
  const [linked, setLinked] = useState(false);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    const statusRes = await fetch("/api/plaid/status");
    const status = await statusRes.json();
    setLinked(!!status.linked);
    if (!status.linked) {
      setTransactions([]);
      return;
    }
    const txRes = await fetch("/api/plaid/transactions");
    const data = await txRes.json();
    setTransactions(Array.isArray(data) ? (data as UITransaction[]) : []);
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/plaid/status")
      .then((res) => res.json())
      .then(async (data) => {
        if (cancelled) return;
        if (!data.linked) {
          setLoading(false);
          return null;
        }
        setLinked(true);
        // In production, run a sync on first visit to clear any stale sandbox data
        const syncKey = "tx_prod_sync_done";
        if (typeof sessionStorage !== "undefined" && !sessionStorage.getItem(syncKey)) {
          try {
            await fetch("/api/plaid/transactions", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: "{}",
            });
            sessionStorage.setItem(syncKey, "1");
          } catch {
            // ignore
          }
        }
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
      .catch(() => {
        if (!cancelled) setLoading(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  return { transactions, linked, loading, refetch };
}
