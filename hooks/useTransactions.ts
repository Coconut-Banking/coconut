"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { UITransaction } from "@/lib/transaction-types";

export type Transaction = UITransaction;

export function useTransactions() {
  const [transactions, setTransactions] = useState<UITransaction[]>([]);
  const [linked, setLinked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const syncingRef = useRef(false);

  const refetch = useCallback(async (opts?: { bypassCache?: boolean }) => {
    setLoading(true);
    try {
      setError(null);
      const statusRes = await fetch("/api/plaid/status");
      if (!statusRes.ok) { setError("Failed to check bank connection"); return; }
      const status = await statusRes.json();
      setLinked(!!status.linked);
      if (!status.linked) { setTransactions([]); return; }
      const url = opts?.bypassCache ? "/api/plaid/transactions?refresh=1" : "/api/plaid/transactions";
      const txRes = await fetch(url);
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
    } finally {
      setLoading(false);
    }
  }, []);

  const syncAndRefetch = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    try {
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
        await refetch({ bypassCache: true });
      } catch {
        await refetch();
      }
    } finally {
      syncingRef.current = false;
    }
  }, [refetch]);

  useEffect(() => {
    let cancelled = false;

    // Fire status check and initial transaction fetch in parallel to eliminate waterfall
    Promise.all([
      fetch("/api/plaid/status"),
      fetch("/api/plaid/transactions"),
    ])
      .then(async ([statusRes, txRes]) => {
        if (cancelled) return;
        if (!statusRes.ok) throw new Error("status check failed");

        // Read header before consuming body (headers are always accessible independently of body)
        const needsSync = txRes.headers.get("X-Needs-Sync") === "1";

        // Parallelize JSON parsing for both responses
        const [status, initialData] = await Promise.all([
          statusRes.json(),
          txRes.ok ? txRes.json().catch(() => null) : Promise.resolve(null),
        ]);
        if (cancelled) return;

        if (!status.linked) {
          setLinked(false);
          setTransactions([]);
          setLoading(false);
          return;
        }

        setLinked(true);

        // Show initial data immediately from the parallel fetch
        let initialTxCount = 0;
        if (txRes.ok) {
          if (!cancelled && Array.isArray(initialData)) {
            setTransactions(initialData as UITransaction[]);
            initialTxCount = initialData.length;
          }
        }

        // Keep spinner if bank is connected but has no cached data yet (first-time user)
        if (needsSync && !cancelled) {
          setLoading(true);
        } else {
          setLoading(false);
        }

        // On hard refresh OR first-time needs-sync, trigger a background sync then re-fetch.
        // Fallback: if status.linked is true but we got 0 transactions AND no X-Needs-Sync
        // (race where plaid_items row wasn't written yet when the parallel GET fired),
        // still attempt one background sync so the user doesn't see a permanently blank page.
        const nav = typeof performance !== "undefined" && performance.getEntriesByType?.("navigation")?.[0];
        const isReload = nav && (nav as PerformanceNavigationTiming).type === "reload";
        const linkedButEmpty = !needsSync && initialTxCount === 0;
        if ((isReload || needsSync || linkedButEmpty) && !cancelled) {
          try {
            await fetch("/api/plaid/transactions", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: "{}",
            });
            if (!cancelled) {
              const fresh = await fetch("/api/plaid/transactions?refresh=1");
              if (fresh.ok && !cancelled) {
                const freshData = await fresh.json().catch(() => null);
                if (!cancelled && Array.isArray(freshData)) {
                  setTransactions(freshData as UITransaction[]);
                }
              }
            }
          } catch {
            // ignore — already showing initial data
          } finally {
            if (!cancelled) setLoading(false);
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("Failed to load transactions");
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, []);

  return { transactions, linked, loading, error, refetch, syncAndRefetch };
}
