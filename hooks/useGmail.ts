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
    console.log("[useGmail] Fetching Gmail status...");
    try {
      const res = await fetch("/api/gmail/status");
      console.log("[useGmail] Status response:", res.status);

      if (!res.ok) {
        console.error("[useGmail] Status check failed:", res.status);
        setState((prev) => ({ ...prev, loading: false }));
        return;
      }

      const data = await res.json();
      console.log("[useGmail] Status data:", data);

      setState((prev) => ({
        ...prev,
        connected: data.connected,
        email: data.email,
        lastScan: data.lastScanAt,
        loading: false,
      }));
    } catch (e) {
      console.error("[useGmail] Status check error:", e);
      setState((prev) => ({ ...prev, loading: false }));
    }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const connect = useCallback(async () => {
    console.log("[useGmail] Starting Gmail connection...");
    try {
      const res = await fetch("/api/gmail/auth");
      console.log("[useGmail] Auth response:", res.status);

      if (!res.ok) {
        console.error("[useGmail] Failed to get auth URL");
        return;
      }

      const { authUrl } = await res.json();
      console.log("[useGmail] Redirecting to Google OAuth:", authUrl);
      window.location.href = authUrl;
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
