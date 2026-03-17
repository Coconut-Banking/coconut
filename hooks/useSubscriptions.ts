"use client";

import { useState, useEffect, useCallback } from "react";
import { hashColor, fmtDate } from "@/lib/plaid-mappers";

export interface PriceChange {
  previous: number;
  change: number;
  detectedAt: string;
}

export interface Subscription {
  id: string;
  merchant: string;
  amount: number;
  frequency: string;
  lastCharged: string | null;
  nextDue: string | null;
  category: string;
  transactionCount: number;
  status: string;
  confidence: number | null;
  priceChange: PriceChange | null;
}

export function useSubscriptions() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSubs = useCallback(async (isCancelled?: () => boolean) => {
    try {
      setError(null);
      const res = await fetch("/api/subscriptions");
      if (isCancelled?.()) return;
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Failed to load subscriptions");
        return;
      }
      const data = await res.json();
      if (isCancelled?.()) return;
      setSubscriptions(Array.isArray(data) ? data : []);
    } catch {
      if (!isCancelled?.()) setError("Failed to load subscriptions");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchSubs(() => cancelled).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [fetchSubs]);

  const detect = useCallback(async () => {
    setDetecting(true);
    try {
      const res = await fetch("/api/subscriptions", { method: "POST" });
      if (res.ok) await fetchSubs();
    } catch (e) {
      console.error("[subscriptions] detect:", e);
    } finally {
      setDetecting(false);
    }
  }, [fetchSubs]);

  const dismiss = useCallback(async (id: string) => {
    // Optimistic update with rollback on failure
    const previousSubscriptions = subscriptions;
    setSubscriptions((prev) => prev.filter((s) => s.id !== id));

    try {
      const res = await fetch(`/api/subscriptions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "dismissed" }),
      });
      if (!res.ok) {
        // Rollback on API error
        setSubscriptions(previousSubscriptions);
      }
    } catch (e) {
      console.error("[subscriptions] dismiss:", e);
      // Rollback on network error
      setSubscriptions(previousSubscriptions);
    }
  }, [subscriptions]);

  const dismissPriceChange = useCallback(async (id: string) => {
    // Optimistic update with rollback on failure
    const previousSubscriptions = subscriptions;
    setSubscriptions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, priceChange: null } : s))
    );

    try {
      const res = await fetch(`/api/subscriptions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dismissPriceChange: true }),
      });
      if (!res.ok) {
        // Rollback on API error
        setSubscriptions(previousSubscriptions);
      }
    } catch (e) {
      console.error("[subscriptions] dismissPriceChange:", e);
      // Rollback on network error
      setSubscriptions(previousSubscriptions);
    }
  }, [subscriptions]);

  const totalMonthly = subscriptions.reduce((acc, s) => {
    if (s.frequency === "monthly") return acc + s.amount;
    if (s.frequency === "yearly") return acc + s.amount / 12;
    if (s.frequency === "semiannual") return acc + s.amount / 6;
    if (s.frequency === "quarterly") return acc + s.amount / 3;
    if (s.frequency === "weekly") return acc + (s.amount * 52) / 12;
    if (s.frequency === "biweekly") return acc + (s.amount * 26) / 12;
    return acc + s.amount;
  }, 0);

  return {
    subscriptions: subscriptions.map((s) => ({
      ...s,
      merchantColor: hashColor(s.merchant),
      lastChargedStr: fmtDate(s.lastCharged),
      nextDueStr: fmtDate(s.nextDue),
    })),
    totalMonthly,
    totalAnnual: totalMonthly * 12,
    loading,
    detecting,
    error,
    detect,
    dismiss,
    dismissPriceChange,
    refetch: fetchSubs,
  };
}
