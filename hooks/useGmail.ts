"use client";

import { useState, useEffect, useCallback } from "react";

interface GmailState {
  connected: boolean;
  email: string | null;
  lastScan: string | null;
  loading: boolean;
  scanning: boolean;
  scanResult: { scanned: number; matched: number } | null;
  tokenError: boolean;
}

export function useGmail() {
  const [state, setState] = useState<GmailState>({
    connected: false,
    email: null,
    lastScan: null,
    loading: true,
    scanning: false,
    scanResult: null,
    tokenError: false,
  });

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/gmail/status");
      if (!res.ok) return;
      const data = await res.json();
      setState((prev) => ({
        ...prev,
        connected: data.connected,
        email: data.email,
        lastScan: data.lastScan,
        loading: false,
      }));
    } catch {
      setState((prev) => ({ ...prev, loading: false }));
    }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const connect = useCallback(async () => {
    try {
      const res = await fetch("/api/gmail/auth");
      if (!res.ok) return;
      const { url } = await res.json();
      window.location.href = url;
    } catch (e) {
      console.error("[useGmail] connect failed:", e);
    }
  }, []);

  const disconnect = useCallback(async () => {
    try {
      await fetch("/api/gmail/disconnect", { method: "POST" });
      setState((prev) => ({ ...prev, connected: false, email: null, lastScan: null, scanResult: null }));
    } catch (e) {
      console.error("[useGmail] disconnect failed:", e);
    }
  }, []);

  const scan = useCallback(async () => {
    setState((prev) => ({ ...prev, scanning: true, scanResult: null, tokenError: false }));
    try {
      const res = await fetch("/api/gmail/scan", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body.authError) {
          setState((prev) => ({ ...prev, scanning: false, tokenError: true }));
          return;
        }
        throw new Error("Scan failed");
      }
      const data = await res.json();
      setState((prev) => ({
        ...prev,
        scanning: false,
        scanResult: { scanned: data.scanned, matched: data.matched },
        lastScan: new Date().toISOString(),
      }));
    } catch (e) {
      console.error("[useGmail] scan failed:", e);
      setState((prev) => ({ ...prev, scanning: false }));
    }
  }, []);

  return { ...state, connect, disconnect, scan };
}
