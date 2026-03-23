"use client";

import { useState, useEffect } from "react";
import { Loader2, CheckCircle2, XCircle, Mail, AlertCircle } from "lucide-react";
import { motion } from "motion/react";

export default function TestGmailPage() {
  const [status, setStatus] = useState<"loading" | "connected" | "disconnected" | "error">("loading");
  const [error, setError] = useState<string>("");
  const [gmailInfo, setGmailInfo] = useState<any>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [scanResults, setScanResults] = useState<any>(null);
  const [isScanning, setIsScanning] = useState(false);

  useEffect(() => {
    checkStatus();
  }, []);

  const checkStatus = async () => {
    try {
      const res = await fetch("/api/gmail/status");
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to check status");
      }
      const data = await res.json();
      setGmailInfo(data);
      setStatus(data.connected ? "connected" : "disconnected");
    } catch (err: any) {
      console.error("Status check error:", err);
      setStatus("error");
      setError(err.message || "Failed to check Gmail status");
    }
  };

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      const res = await fetch("/api/gmail/auth");
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to start auth");
      }
      const { authUrl } = await res.json();
      window.location.href = authUrl;
    } catch (err: any) {
      console.error("Connection error:", err);
      setError(err.message || "Failed to connect");
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm("Are you sure you want to disconnect Gmail?")) return;

    setIsConnecting(true);
    try {
      const res = await fetch("/api/gmail/disconnect", { method: "POST" });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to disconnect");
      }
      setStatus("disconnected");
      setGmailInfo(null);
      setScanResults(null);
    } catch (err: any) {
      console.error("Disconnect error:", err);
      setError(err.message || "Failed to disconnect");
    }
    setIsConnecting(false);
  };

  const handleScan = async () => {
    setIsScanning(true);
    setError("");
    try {
      const res = await fetch("/api/gmail/scan", { method: "POST" });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to scan");
      }
      const data = await res.json();
      setScanResults(data);
    } catch (err: any) {
      console.error("Scan error:", err);
      setError(err.message || "Failed to scan for receipts");
    }
    setIsScanning(false);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-2xl mx-auto"
      >
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Gmail Integration Test</h1>
          <p className="text-sm text-gray-500 mt-1">Test your Gmail API connection and receipt scanning</p>
        </div>

        {/* Status Card */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Connection Status</h2>
            {status === "loading" && <Loader2 className="w-5 h-5 animate-spin text-gray-400" />}
            {status === "connected" && <CheckCircle2 className="w-5 h-5 text-green-500" />}
            {status === "disconnected" && <XCircle className="w-5 h-5 text-gray-400" />}
            {status === "error" && <AlertCircle className="w-5 h-5 text-red-500" />}
          </div>

          {status === "loading" && (
            <p className="text-sm text-gray-500">Checking Gmail connection...</p>
          )}

          {status === "connected" && gmailInfo && (
            <div className="space-y-2">
              <p className="text-sm text-gray-600">
                <span className="font-medium">Email:</span> {gmailInfo.email || "Connected"}
              </p>
              {gmailInfo.lastScanAt && (
                <p className="text-sm text-gray-600">
                  <span className="font-medium">Last Scan:</span> {new Date(gmailInfo.lastScanAt).toLocaleString()}
                </p>
              )}
              <div className="flex gap-2 mt-4">
                <button
                  onClick={handleScan}
                  disabled={isScanning}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {isScanning ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Scanning...
                    </>
                  ) : (
                    <>
                      <Mail className="w-4 h-4" />
                      Scan for Receipts
                    </>
                  )}
                </button>
                <button
                  onClick={handleDisconnect}
                  disabled={isConnecting}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-300 disabled:opacity-50"
                >
                  Disconnect
                </button>
              </div>
            </div>
          )}

          {status === "disconnected" && (
            <div>
              <p className="text-sm text-gray-500 mb-4">Gmail is not connected</p>
              <button
                onClick={handleConnect}
                disabled={isConnecting}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isConnecting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <Mail className="w-4 h-4" />
                    Connect Gmail
                  </>
                )}
              </button>
            </div>
          )}

          {status === "error" && (
            <div className="space-y-2">
              <p className="text-sm text-red-600">{error}</p>
              <button
                onClick={checkStatus}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-300"
              >
                Retry
              </button>
            </div>
          )}
        </div>

        {/* Error Messages */}
        {error && status !== "error" && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {/* Scan Results */}
        {scanResults && (
          <div className="bg-white rounded-2xl border border-gray-100 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Scan Results</h3>
            <div className="space-y-2">
              <p className="text-sm text-gray-600">
                <span className="font-medium">Emails Scanned:</span> {scanResults.scanned || 0}
              </p>
              <p className="text-sm text-gray-600">
                <span className="font-medium">Receipts Found:</span> {scanResults.found || 0}
              </p>
              <p className="text-sm text-gray-600">
                <span className="font-medium">New Receipts:</span> {scanResults.new || 0}
              </p>
              {scanResults.receipts && scanResults.receipts.length > 0 && (
                <div className="mt-4">
                  <p className="text-sm font-medium text-gray-700 mb-2">Recent Receipts:</p>
                  <div className="space-y-2">
                    {scanResults.receipts.slice(0, 5).map((receipt: any, idx: number) => (
                      <div key={idx} className="text-sm text-gray-600 pl-4 border-l-2 border-gray-200">
                        <p className="font-medium">{receipt.merchant}</p>
                        <p>${receipt.amount} - {new Date(receipt.date).toLocaleDateString()}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Environment Check */}
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mt-6">
          <h3 className="text-sm font-semibold text-yellow-800 mb-2">Setup Checklist</h3>
          <div className="space-y-1 text-xs text-yellow-700">
            <p>1. Set GOOGLE_CLIENT_ID in .env.local</p>
            <p>2. Set GOOGLE_CLIENT_SECRET in .env.local</p>
            <p>3. Set GOOGLE_REDIRECT_URI to: https://coconut-app.dev/api/gmail/callback (prod) or http://localhost:3000/api/gmail/callback (local)</p>
            <p>4. Add redirect URI to Google Cloud Console OAuth settings</p>
            <p>5. Run database migration: docs/supabase-migration-gmail-receipts.sql</p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}