"use client";

import { useState, useEffect, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, Mail, Package, Calendar, ChevronRight, RefreshCw, AlertCircle, CheckCircle2, Search, ChevronDown, X, ExternalLink } from "lucide-react";
import { motion } from "motion/react";
import { useGmail } from "@/hooks/useGmail";
import { formatCurrency } from "@/lib/currency";

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

type DatePreset = "30d" | "3m" | "6m" | "1y" | "all" | "custom";

const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: "30d", label: "Past 30 Days" },
  { value: "3m", label: "Past 3 Months" },
  { value: "6m", label: "Past 6 Months" },
  { value: "1y", label: "Past Year" },
  { value: "all", label: "All Time" },
  { value: "custom", label: "Custom Range" },
];

function getPresetRange(preset: DatePreset): { start: Date | null; end: Date } {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  if (preset === "all") return { start: null, end };
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (preset === "30d") start.setDate(start.getDate() - 30);
  else if (preset === "3m") start.setMonth(start.getMonth() - 3);
  else if (preset === "6m") start.setMonth(start.getMonth() - 6);
  else if (preset === "1y") start.setFullYear(start.getFullYear() - 1);
  return { start, end };
}

interface ScanResult {
  emailsFetched: number;
  alreadyProcessed: number;
  parsed: number;
  notReceipt: number;
  noBody: number;
  parseErrors: number;
  insertErrors: number;
  inserted: number;
  matched: number;
  error?: string;
}

function EmailReceiptsContent() {
  const searchParams = useSearchParams();
  const gmail = useGmail();
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [scanResults, setScanResults] = useState<ScanResult | null>(null);
  const [error, setError] = useState("");
  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null);
  const [filter, setFilter] = useState("");
  const [datePreset, setDatePreset] = useState<DatePreset>("30d");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [showPresetMenu, setShowPresetMenu] = useState(false);

  useEffect(() => {
    const connected = searchParams.get("connected");
    const authError = searchParams.get("error");

    if (connected === "true") {
      const url = new URL(window.location.href);
      url.searchParams.delete("connected");
      url.searchParams.delete("error");
      window.history.replaceState({}, "", url);
    } else if (authError) {
      setError(authError === "auth_failed" ? "Failed to connect Gmail. Please try again." : "Connection error");
    }
  }, [searchParams]);

  useEffect(() => {
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
    setScanResults(null);
    try {
      const res = await fetch("/api/gmail/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ daysBack: 30, detailed: true, forceRescan }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Scan failed");
      }

      const data = await res.json() as ScanResult;
      setScanResults(data);

      if (data.error) {
        setError(data.error);
      } else if (data.inserted === 0 && data.emailsFetched > 0 && data.alreadyProcessed === data.emailsFetched) {
        setError("All emails have already been processed. Try 'Force Rescan All' to reprocess.");
      } else if (data.inserted === 0 && data.emailsFetched > 0) {
        setError("No new receipts found in the scanned emails.");
      }

      await loadReceipts();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to scan emails");
    } finally {
      setIsScanning(false);
    }
  };

  const filteredReceipts = useMemo(() => {
    let start: Date | null = null;
    let end: Date | null = null;

    if (datePreset === "custom") {
      start = customStart ? new Date(customStart + "T00:00:00") : null;
      end = customEnd ? new Date(customEnd + "T23:59:59") : null;
    } else if (datePreset !== "all") {
      const range = getPresetRange(datePreset);
      start = range.start;
      end = range.end;
    }

    return receipts.filter((r) => {
      const matchesText =
        !filter ||
        (r.merchant ?? "").toLowerCase().includes(filter.toLowerCase()) ||
        (r.raw_subject ?? "").toLowerCase().includes(filter.toLowerCase());

      if (!matchesText) return false;

      const receiptDate = new Date(r.date + "T12:00:00");
      if (start && receiptDate < start) return false;
      if (end && receiptDate > end) return false;

      return true;
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [receipts, filter, datePreset, customStart, customEnd]);

  const totalAmount = filteredReceipts.reduce((sum, r) => sum + r.amount, 0);

  const activePresetLabel = DATE_PRESETS.find((p) => p.value === datePreset)?.label ?? "All Time";

  if (gmail.loading) {
    return (
      <div className="min-h-screen bg-gray-50" />
    );
  }

  if (!gmail.connected) {
    return (
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
            <div className="w-16 h-16 rounded-2xl bg-[#EEF7F2] flex items-center justify-center mx-auto mb-4">
              <Mail className="w-8 h-8 text-[#3D8E62]" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Connect Gmail to Get Started</h2>
            <p className="text-sm text-gray-500 mb-6">
              We&apos;ll scan your email for receipts from Amazon, Walmart, and other merchants
            </p>
            <button
              onClick={gmail.connect}
              className="px-6 py-3 bg-[#3D8E62] text-white rounded-xl text-sm font-medium hover:bg-[#2D7A52] transition-colors"
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
                Connected as {gmail.email} &bull; Last scan: {gmail.lastScan ? new Date(gmail.lastScan).toLocaleString() : "Never"}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => handleScan(false)}
                disabled={isScanning}
                className="px-4 py-2 bg-[#3D8E62] text-white rounded-xl text-sm font-medium hover:bg-[#2D7A52] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
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
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
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
      {scanResults && !scanResults.error && (
        <div className="bg-[#EEF7F2] border-b border-[#C3E0D3]">
          <div className="max-w-6xl mx-auto px-4 py-3">
            <div className="flex items-center gap-2 text-sm text-[#3D8E62]">
              <CheckCircle2 className="w-4 h-4" />
              <span>
                Scanned {scanResults.emailsFetched} emails
                {scanResults.alreadyProcessed > 0 && ` (${scanResults.alreadyProcessed} already processed)`}
                {" "}&bull; {scanResults.parsed} receipts found
                {" "}&bull; {scanResults.inserted} new saved
                {scanResults.matched > 0 && ` \u00b7 ${scanResults.matched} matched to transactions`}
                {scanResults.parseErrors > 0 && ` \u00b7 ${scanResults.parseErrors} errors`}
              </span>
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
        {/* Date Filter + Search */}
        <div className="bg-white rounded-xl border border-gray-100 p-4 mb-6">
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Date preset dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowPresetMenu((v) => !v)}
                className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-700 hover:bg-gray-50 transition-colors min-w-[170px] justify-between"
              >
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-[#3D8E62]" />
                  <span>{activePresetLabel}</span>
                </div>
                <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
              </button>
              {showPresetMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowPresetMenu(false)} />
                  <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-20 py-1 min-w-[170px]">
                    {DATE_PRESETS.map((p) => (
                      <button
                        key={p.value}
                        onClick={() => {
                          setDatePreset(p.value);
                          setShowPresetMenu(false);
                          if (p.value !== "custom") {
                            setCustomStart("");
                            setCustomEnd("");
                          }
                        }}
                        className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                          datePreset === p.value
                            ? "bg-[#EEF7F2] text-[#3D8E62] font-medium"
                            : "text-gray-700 hover:bg-gray-50"
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Custom date pickers */}
            {datePreset === "custom" && (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#3D8E62]/20 focus:border-[#3D8E62]"
                />
                <span className="text-xs text-gray-400">to</span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#3D8E62]/20 focus:border-[#3D8E62]"
                />
                {(customStart || customEnd) && (
                  <button
                    onClick={() => { setCustomStart(""); setCustomEnd(""); }}
                    className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}

            {/* Reset to all time shortcut */}
            {datePreset !== "all" && (
              <button
                onClick={() => { setDatePreset("all"); setCustomStart(""); setCustomEnd(""); }}
                className="text-xs text-[#3D8E62] hover:underline self-center whitespace-nowrap"
              >
                Show all
              </button>
            )}

            {/* Search */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search by merchant or subject..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#3D8E62]/20 focus:border-[#3D8E62]"
              />
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-xl border border-gray-100 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Receipts</p>
                <p className="text-2xl font-bold text-gray-900">{filteredReceipts.length}</p>
              </div>
              <Package className="w-8 h-8 text-gray-400" />
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Total Spent</p>
                <p className="text-2xl font-bold text-gray-900">{formatCurrency(totalAmount)}</p>
              </div>
              <Calendar className="w-8 h-8 text-gray-400" />
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Merchants</p>
                <p className="text-2xl font-bold text-gray-900">
                  {new Set(filteredReceipts.map((r) => r.merchant)).size}
                </p>
              </div>
              <Mail className="w-8 h-8 text-gray-400" />
            </div>
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
                    ? "No receipts found. Click 'Scan New' to search your emails."
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
                        ? "border-[#3D8E62] ring-2 ring-[#3D8E62]/20"
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
                            <span className="px-2 py-0.5 bg-[#EEF7F2] text-[#3D8E62] text-xs rounded-full font-medium">
                              Matched
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-500 line-clamp-1">{receipt.raw_subject}</p>
                        <p className="text-xs text-gray-400 mt-1">
                          {new Date(receipt.date).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-gray-900">
                          {formatCurrency(receipt.amount)}
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
                  {selectedReceipt.gmail_message_id && (
                    <a
                      href={`https://mail.google.com/mail/u/0/#inbox/${selectedReceipt.gmail_message_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 bg-[#EEF7F2] text-[#3D8E62] text-xs font-medium rounded-lg hover:bg-[#D1EAE0] transition-colors"
                    >
                      <ExternalLink className="w-3 h-3" />
                      View in Gmail
                    </a>
                  )}
                </div>

                {selectedReceipt.line_items && selectedReceipt.line_items.length > 0 ? (
                  <div>
                    <h5 className="text-sm font-semibold text-gray-700 mb-3">Items</h5>
                    <div className="space-y-2">
                      {selectedReceipt.line_items.map((item, idx) => {
                        const price = item.unit_price || item.price || item.total || 0;
                        const quantity = item.quantity || 1;
                        const total = item.total || price * quantity || 0;

                        return (
                          <div key={idx} className="flex justify-between py-2 border-b border-gray-100 last:border-0">
                            <div className="flex-1">
                              <p className="text-sm text-gray-900">{item.name}</p>
                              <p className="text-xs text-gray-500">Qty: {quantity}</p>
                            </div>
                            <p className="text-sm font-medium text-gray-900">
                              {formatCurrency(total)}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-4 pt-4 border-t border-gray-200">
                      <div className="flex justify-between">
                        <p className="text-lg font-semibold text-gray-900">Total</p>
                        <p className="text-lg font-bold text-gray-900">
                          {formatCurrency(selectedReceipt.amount)}
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
                          {formatCurrency(selectedReceipt.amount)}
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
