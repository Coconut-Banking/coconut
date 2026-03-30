"use client";

import { useState, useEffect, useCallback } from "react";

export interface Account {
  account_id: string;
  id: string | null;
  name: string;
  type?: string;
  subtype?: string;
  mask?: string | null;
  balance_current: number | null;
  balance_available: number | null;
  iso_currency_code: string;
}

export function useAccounts(linked: boolean) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(linked);

  const fetchAccounts = useCallback(() => {
    if (!linked) {
      setAccounts([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    fetch("/api/plaid/accounts", { signal: controller.signal })
      .then(async (res) => {
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setAccounts(Array.isArray(data.accounts) ? data.accounts : []);
        } else {
          if (!cancelled) setAccounts([]);
        }
      })
      .catch(() => {
        if (!cancelled) setAccounts([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [linked]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    if (!linked) {
      setAccounts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch("/api/plaid/accounts", { signal: controller.signal })
      .then(async (res) => {
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setAccounts(Array.isArray(data.accounts) ? data.accounts : []);
        } else {
          if (!cancelled) setAccounts([]);
        }
      })
      .catch(() => {
        if (!cancelled) setAccounts([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [linked]);

  const usAccounts = accounts.filter((a) => (a.iso_currency_code ?? "USD") === "USD");
  const cadAccounts = accounts.filter((a) => (a.iso_currency_code ?? "USD") === "CAD");
  const otherAccounts = accounts.filter((a) => {
    const c = a.iso_currency_code ?? "USD";
    return c !== "USD" && c !== "CAD";
  });

  return {
    accounts,
    usAccounts,
    cadAccounts,
    otherAccounts,
    loading,
    refetch: fetchAccounts,
  };
}
