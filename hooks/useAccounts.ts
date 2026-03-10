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
  const [loading, setLoading] = useState(false);

  const fetchAccounts = useCallback(async () => {
    if (!linked) {
      setAccounts([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/plaid/accounts");
      if (res.ok) {
        const data = await res.json();
        setAccounts(data.accounts ?? []);
      } else {
        setAccounts([]);
      }
    } catch {
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }, [linked]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

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
