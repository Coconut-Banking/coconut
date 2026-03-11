"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, Mail, Package, Calendar, ChevronRight, RefreshCw, AlertCircle, CheckCircle2, Search } from "lucide-react";
import { motion } from "motion/react";
import { useGmail } from "@/hooks/useGmail";

interface Receipt {
  id: string;
  merchant: string;
  amount: number;
  date: string;
  currency: string;
  line_items?: Array<{
    name: string;
    quantity: number;
    price: number;
    unit_price?: number;
    total?: number;
  }>;
  raw_subject: string;
  raw_from: string;
  gmail_message_id: string;
  transaction_id?: string;
}

function EmailReceiptsContent() {
  const searchParams = useSearchParams();
  const gmail = useGmail();
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [scanResults, setScanResults] = useState<any>(null);
  const [error, setError] = useState("");
  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null);
  const [filter, setFilter] = useState("");
  const [showConnectedMessage, setShowConnectedMessage] = useState(false);

  useEffect(() => {
    // Check for connection success/error from OAuth callback
    const connected = searchParams.get("connected");
    const authError = searchParams.get("error");

    console.log("[EmailReceipts] Page loaded with params:", { connected, authError });

    if (connected === "true") {
      console.log("[EmailReceipts] Just connected, showing success message");
      setShowConnectedMessage(true);
      // Remove the query params to prevent reload loop
      const url = new URL(window.location.href);
      url.searchParams.delete('connected');
      url.searchParams.delete('error');
      window.history.replaceState({}, '', url);
    } else if (authError) {
      console.error("[EmailReceipts] Auth error:", authError);
      setError(authError === "auth_failed" ? "Failed to connect Gmail. Please try again." : "Connection error");
    }
  }, [searchParams]);

  useEffect(() => {
    console.log("[EmailReceipts] Gmail status:", {
      connected: gmail.connected,
      email: gmail.email,
      loading: gmail.loading
    });

    if (gmail.connected) {
      loadReceipts();
    }
  }, [gmail.connected]);

  const loadReceipts = async () => {
    try {
      const res = await fetch("/api/email-receipts");
      if (res.ok) {
        const data = await res.json();
        setReceipts(data.receipts || []);
      }
    } catch (err) {
      console.error("Failed to load receipts:", err);
    }
  };

  const handleScan = async (forceRescan = false) => {
    setIsScanning(true);
    setError("");
    try {
      const res = await fetch("/api/gmail/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          daysBack: 30,
          detailed: true,
          forceRescan: forceRescan
        })
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Scan failed");
      }

      const data = await res.json();
      setScanResults(data);

      // Check for specific error about OpenAI
      if (data.error) {
        setError(data.error);
      } else if (data.found === 0 && data.scanned > 0) {
        setError("No receipts found. Make sure you have receipt emails from supported merchants.");
      }

      // Reload receipts after scan
      await loadReceipts();
    } catch (err: any) {
      setError(err.message || "Failed to scan emails");
    } finally {
      setIsScanning(false);
    }
  };

  const filteredReceipts = receipts.filter(r =>
    !filter ||
    (r.merchant ?? "").toLowerCase().includes(filter.toLowerCase()) ||
    (r.raw_subject ?? "").toLowerCase().includes(filter.toLowerCase())
  );

  const totalAmount = filteredReceipts.reduce((sum, r) => sum + r.amount, 0);

  if (!gmail.connected) {
    return (
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
            <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center mx-auto mb-4">
              <Mail className="w-8 h-8 text-blue-600" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Connect Gmail to Get Started</h2>
            <p className="text-sm text-gray-500 mb-6">
              We'll scan your email for receipts from Amazon, Walmart, and other merchants
            </p>
            <button
              onClick={gmail.connect}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
            >
              Connect Gmail
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Email Receipts</h1>
              <p className="text-sm text-gray-500 mt-1">
                Connected as {gmail.email} • Last scan: {gmail.lastScan ? new Date(gmail.lastScan).toLocaleString() : "Never"}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => handleScan(false)}
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
                    <RefreshCw className="w-4 h-4" />
                    Scan New
                  </>
                )}
              </button>
              <button
                onClick={() => handleScan(true)}
                disabled={isScanning}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                title="Reprocess all emails, even ones already scanned"
              >
                {isScanning ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Rescanning...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4" />
                    Force Rescan All
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Scan Results Banner */}
      {scanResults && (
        <div className="bg-green-50 border-b border-green-200">
          <div className="max-w-6xl mx-auto px-4 py-3">
            <div className="flex items-center gap-2 text-sm text-green-700">
              <CheckCircle2 className="w-4 h-4" />
              Scanned {scanResults.scanned} emails • Found {scanResults.found} receipts • {scanResults.new} new
            </div>
          </div>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="bg-red-50 border-b border-red-200">
          <div className="max-w-6xl mx-auto px-4 py-3">
            <div className="flex items-center gap-2 text-sm text-red-700">
              <AlertCircle className="w-4 h-4" />
              {error}
            </div>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-xl border border-gray-100 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Total Receipts</p>
                <p className="text-2xl font-bold text-gray-900">{receipts.length}</p>
              </div>
              <Package className="w-8 h-8 text-gray-400" />
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Total Spent</p>
                <p className="text-2xl font-bold text-gray-900">${totalAmount.toFixed(2)}</p>
              </div>
              <Calendar className="w-8 h-8 text-gray-400" />
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Merchants</p>
                <p className="text-2xl font-bold text-gray-900">
                  {new Set(receipts.map(r => r.merchant)).size}
                </p>
              </div>
              <Mail className="w-8 h-8 text-gray-400" />
            </div>
          </div>
        </div>

        {/* Search Bar */}
        <div className="bg-white rounded-xl border border-gray-100 p-4 mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search by merchant or subject..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Receipts List */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-700">Recent Receipts</h3>
            {filteredReceipts.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
                <p className="text-sm text-gray-500">
                  {receipts.length === 0
                    ? "No receipts found. Click 'Scan Last 30 Days' to search your emails."
                    : "No receipts match your search."}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredReceipts.map((receipt) => (
                  <motion.div
                    key={receipt.id}
                    onClick={() => setSelectedReceipt(receipt)}
                    className={`bg-white rounded-xl border ${
                      selectedReceipt?.id === receipt.id
                        ? "border-blue-500 ring-2 ring-blue-100"
                        : "border-gray-100 hover:border-gray-200"
                    } p-4 cursor-pointer transition-all`}
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-semibold text-gray-900">{receipt.merchant}</h4>
                          {receipt.transaction_id && (
                            <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">
                              Matched
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-500">{receipt.raw_subject}</p>
                        <p className="text-xs text-gray-400 mt-1">
                          {new Date(receipt.date).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-gray-900">
                          ${receipt.amount.toFixed(2)}
                        </p>
                        <ChevronRight className="w-4 h-4 text-gray-400 ml-auto" />
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>

          {/* Receipt Details */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-700">Receipt Details</h3>
            {selectedReceipt ? (
              <div className="bg-white rounded-xl border border-gray-100 p-6">
                <div className="mb-6">
                  <h4 className="text-xl font-bold text-gray-900">{selectedReceipt.merchant}</h4>
                  <p className="text-sm text-gray-500 mt-1">{selectedReceipt.raw_subject}</p>
                  <p className="text-xs text-gray-400 mt-2">
                    From: {selectedReceipt.raw_from}
                  </p>
                  <p className="text-xs text-gray-400">
                    Date: {new Date(selectedReceipt.date).toLocaleString()}
                  </p>
                </div>

                {selectedReceipt.line_items && selectedReceipt.line_items.length > 0 ? (
                  <div>
                    <h5 className="text-sm font-semibold text-gray-700 mb-3">Items</h5>
                    <div className="space-y-2">
                      {selectedReceipt.line_items.map((item, idx) => {
                        // Calculate the price, handling various field names and missing values
                        const price = item.unit_price || item.price || item.total || 0;
                        const quantity = item.quantity || 1;
                        const total = item.total || (price * quantity) || 0;

                        return (
                          <div key={idx} className="flex justify-between py-2 border-b border-gray-100 last:border-0">
                            <div className="flex-1">
                              <p className="text-sm text-gray-900">{item.name}</p>
                              <p className="text-xs text-gray-500">Qty: {quantity}</p>
                            </div>
                            <p className="text-sm font-medium text-gray-900">
                              ${total.toFixed(2)}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-4 pt-4 border-t border-gray-200">
                      <div className="flex justify-between">
                        <p className="text-lg font-semibold text-gray-900">Total</p>
                        <p className="text-lg font-bold text-gray-900">
                          ${selectedReceipt.amount.toFixed(2)}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <Package className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-sm text-gray-500">No itemized details available</p>
                    <div className="mt-4 pt-4 border-t border-gray-200">
                      <div className="flex justify-between">
                        <p className="text-lg font-semibold text-gray-900">Total</p>
                        <p className="text-lg font-bold text-gray-900">
                          ${selectedReceipt.amount.toFixed(2)}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
                <Mail className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-sm text-gray-500">Select a receipt to view details</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function EmailReceiptsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>}>
      <EmailReceiptsContent />
    </Suspense>
  );
}