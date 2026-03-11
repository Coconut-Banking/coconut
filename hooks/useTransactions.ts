"use client";

import { useState, useEffect, useCallback } from "react";
import type { UITransaction } from "@/lib/transaction-types";

export type Transaction = UITransaction;

export function useTransactions() {
  const [transactions, setTransactions] = useState<UITransaction[]>([]);
  const [linked, setLinked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      setError(null);
      const statusRes = await fetch("/api/plaid/status");
      if (!statusRes.ok) { setError("Failed to check bank connection"); return; }
      const status = await statusRes.json();
      setLinked(!!status.linked);
      if (!status.linked) { setTransactions([]); return; }
      const txRes = await fetch("/api/plaid/transactions");
      if (!txRes.ok) {
        const body = await txRes.json().catch(() => ({}));
        setError(body.error ?? "Failed to load transactions");
        return;
      }
      const data = await txRes.json();
      setTransactions(Array.isArray(data) ? (data as UITransaction[]) : []);
    } catch (e) {
      console.error("[useTransactions] refetch:", e);
      setError("Failed to load transactions");
    }
  }, []);

  const syncAndRefetch = useCallback(async () => {
    const statusRes = await fetch("/api/plaid/status");
    if (!statusRes.ok) return;
    const status = await statusRes.json();
    if (!status.linked) return;
    try {
      await fetch("/api/plaid/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      await refetch();
    } catch {
      await refetch();
    }
  }, [refetch]);

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
        // Sync only on hard refresh (F5 / reload), not on tab return or client nav
        const nav = typeof performance !== "undefined" && performance.getEntriesByType?.("navigation")?.[0];
        const isReload = nav && (nav as PerformanceNavigationTiming).type === "reload";
        if (isReload) {
          try {
            await fetch("/api/plaid/transactions", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: "{}",
            });
          } catch {
            // ignore — will still fetch from cache
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

  return { transactions, linked, loading, error, refetch, syncAndRefetch };
}
