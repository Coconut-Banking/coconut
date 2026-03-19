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
      const res = await fetch("/api/paypal/status");
      if (isCancelled?.()) return;
      if (res.ok) {
        const data = await res.json();
        setState((prev) => ({
          ...prev,
          connected: data.connected,
          email: data.email ?? null,
          lastSync: data.lastSyncAt ?? null,
          loading: false,
        }));
        return;
      }
    } catch {
      // PayPal not configured or network error
    }

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
