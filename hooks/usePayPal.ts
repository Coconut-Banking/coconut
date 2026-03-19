"use client";

import { useState, useEffect, useCallback } from "react";

interface PayPalState {
  connected: boolean;
  email: string | null;
  lastSync: string | null;
  loading: boolean;
  syncing: boolean;
  syncResult: { synced: number; errors: string[] } | null;
}

export function usePayPal() {
  const [state, setState] = useState<PayPalState>({
    connected: false,
    email: null,
    lastSync: null,
    loading: true,
    syncing: false,
    syncResult: null,
  });

  const fetchStatus = useCallback(async (isCancelled?: () => boolean) => {
    try {
      const res = await fetch("/api/paypal/auth");
      if (isCancelled?.()) return;
      // The auth endpoint returns authUrl if env vars are set, or error
      // We need a separate status check — use manual-accounts as proxy
      // and check paypal_connections via a simple status endpoint
    } catch {
      // PayPal not configured
    }

    // Check connection status via paypal sync endpoint (GET would be better, but we check existence)
    try {
      const res = await fetch("/api/manual-accounts");
      if (isCancelled?.()) return;
      if (res.ok) {
        const data = await res.json();
        const paypalWallet = (data.accounts ?? []).find(
          (a: { platform: string }) => a.platform === "paypal"
        );
        // If there's a PayPal wallet with an updatedAt, assume connected
        // Real status will come from the connect flow
        if (paypalWallet) {
          setState((prev) => ({
            ...prev,
            connected: true,
            lastSync: paypalWallet.updatedAt,
            loading: false,
          }));
          return;
        }
      }
    } catch { /* ignore */ }

    if (!isCancelled?.()) {
      setState((prev) => ({ ...prev, loading: false }));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchStatus(() => cancelled);
    return () => { cancelled = true; };
  }, [fetchStatus]);

  const connect = useCallback(async () => {
    try {
      const res = await fetch("/api/paypal/auth");
      if (!res.ok) return;
      const { authUrl } = await res.json();
      if (authUrl) window.location.href = authUrl;
    } catch {
      // PayPal not configured
    }
  }, []);

  const disconnect = useCallback(async () => {
    try {
      await fetch("/api/paypal/disconnect", { method: "POST" });
      setState((prev) => ({
        ...prev,
        connected: false,
        email: null,
        lastSync: null,
        syncResult: null,
      }));
    } catch { /* ignore */ }
  }, []);

  const sync = useCallback(async () => {
    setState((prev) => ({ ...prev, syncing: true, syncResult: null }));
    try {
      const res = await fetch("/api/paypal/sync", { method: "POST" });
      if (!res.ok) throw new Error("Sync failed");
      const data = await res.json();
      setState((prev) => ({
        ...prev,
        syncing: false,
        syncResult: data,
        lastSync: new Date().toISOString(),
      }));
    } catch {
      setState((prev) => ({ ...prev, syncing: false }));
    }
  }, []);

  return { ...state, connect, disconnect, sync };
}
