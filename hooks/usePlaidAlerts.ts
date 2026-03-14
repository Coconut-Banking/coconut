"use client";

import { useState, useEffect, useCallback } from "react";

export function usePlaidAlerts(refreshTrigger?: string) {
  const [needsReauth, setNeedsReauth] = useState(false);
  const [newAccountsAvailable, setNewAccountsAvailable] = useState(false);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch("/api/plaid/status");
      if (!res.ok) return;
      const data = await res.json();
      setNeedsReauth(!!data.needs_reauth);
      setNewAccountsAvailable(!!data.new_accounts_available);
    } catch {
      setNeedsReauth(false);
      setNewAccountsAvailable(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch, refreshTrigger]);

  return { needsReauth, newAccountsAvailable, loading, refetch };
}
