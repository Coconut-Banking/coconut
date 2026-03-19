"use client";

import { useState, useEffect, useMemo, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, Mail, Package, Calendar, ChevronRight, RefreshCw, AlertCircle, CheckCircle2, Search, ChevronDown, X, ExternalLink, Link2, Unlink, ArrowRight } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { motion } from "motion/react";
import { useGmail } from "@/hooks/useGmail";
import { formatCurrency, convertCurrency } from "@/lib/currency";
import { useCurrency, useCompactView } from "@/hooks/useCurrency";

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

interface TransactionCandidate {
  dbId: string;
  merchant: string;
  amount: number;
  date: string;
  dateStr: string;
  isoCurrencyCode: string;
}

type ReviewTab = "unmatched" | "matched";
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
  const { currencyCode } = useCurrency();
  const { compact: compactView } = useCompactView();
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
  const [reviewTab, setReviewTab] = useState<ReviewTab>("unmatched");
  const [showReview, setShowReview] = useState(false);
  const [findingMatchFor, setFindingMatchFor] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<TransactionCandidate[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [matchingReceipt, setMatchingReceipt] = useState<string | null>(null);

  const findCandidates = useCallback(async (receipt: Receipt) => {
    setFindingMatchFor(receipt.id);
    setCandidates([]);
    setLoadingCandidates(true);
    try {
      const res = await fetch("/api/plaid/transactions");
      if (!res.ok) return;
      const transactions: TransactionCandidate[] = await res.json();
      const receiptAmount = Math.abs(receipt.amount);
      const receiptDate = new Date(receipt.date + "T12:00:00").getTime();
      const sevenDays = 7 * 24 * 60 * 60 * 1000;

      const scored = transactions
        .filter((tx) => {
          const txAmount = Math.abs(tx.amount);
          const amountDiff = Math.abs(txAmount - receiptAmount);
          const withinAmount = receiptAmount > 0
            ? amountDiff / receiptAmount <= 0.10
            : amountDiff <= 5;
          const txDate = new Date(tx.date + "T12:00:00").getTime();
          const withinDate = Math.abs(txDate - receiptDate) <= sevenDays;
          return withinAmount && withinDate;
        })
        .map((tx) => ({
          ...tx,
          _amountDiff: Math.abs(Math.abs(tx.amount) - receiptAmount),
          _dateDiff: Math.abs(
            new Date(tx.date + "T12:00:00").getTime() - receiptDate
          ),
        }))
        .sort((a, b) => a._amountDiff - b._amountDiff || a._dateDiff - b._dateDiff)
        .slice(0, 5);

      setCandidates(scored);
    } catch (err) {
      console.error("Failed to find candidates:", err);
    } finally {
      setLoadingCandidates(false);
    }
  }, []);

  const matchReceipt = useCallback(async (receiptId: string, transactionId: string) => {
    setMatchingReceipt(receiptId);
    try {
      const res = await fetch(`/api/email-receipts/${receiptId}/match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId }),
      });
      if (res.ok) {
        setReceipts((prev) =>
          prev.map((r) =>
            r.id === receiptId ? { ...r, transaction_id: transactionId } : r
          )
        );
        setFindingMatchFor(null);
        setCandidates([]);
      }
    } catch (err) {
      console.error("Failed to match receipt:", err);
    } finally {
      setMatchingReceipt(null);
    }
  }, []);

  const unmatchReceipt = useCallback(async (receiptId: string) => {
    setMatchingReceipt(receiptId);
    try {
      const res = await fetch(`/api/email-receipts/${receiptId}/match`, {
        method: "DELETE",
      });
      if (res.ok) {
        setReceipts((prev) =>
          prev.map((r) =>
            r.id === receiptId ? { ...r, transaction_id: undefined } : r
          )
        );
      }
    } catch (err) {
      console.error("Failed to unmatch receipt:", err);
    } finally {
      setMatchingReceipt(null);
    }
  }, []);

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

  const unmatchedReceipts = useMemo(
    () => filteredReceipts.filter((r) => !r.transaction_id),
    [filteredReceipts]
  );
  const matchedReceipts = useMemo(
    () => filteredReceipts.filter((r) => !!r.transaction_id),
    [filteredReceipts]
  );

  const totalAmount = filteredReceipts.reduce((sum, r) => {
    const amt = r.currency && r.currency !== currencyCode ? convertCurrency(r.amount, r.currency, currencyCode) : r.amount;
    return sum + amt;
  }, 0);

  const activePresetLabel = DATE_PRESETS.find((p) => p.value === datePreset)?.label ?? "All Time";

  if (gmail.loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-[#3D8E62]/30 border-t-[#3D8E62] rounded-full animate-spin" />
          <p className="text-sm text-gray-500">Checking Gmail connection...</p>
        </div>
      </div>
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
                <p className="text-2xl font-bold text-gray-900">{formatCurrency(totalAmount, currencyCode)}</p>
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

        {/* Review Matches Section */}
        <div className="mb-6">
          <button
            onClick={() => setShowReview((v) => !v)}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <Link2 className="w-4 h-4 text-[#3D8E62]" />
            Review Matches
            {unmatchedReceipts.length > 0 && (
              <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 text-xs rounded-full font-medium">
                {unmatchedReceipts.length} unmatched
              </span>
            )}
            <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${showReview ? "rotate-180" : ""}`} />
          </button>

          <AnimatePresence>
            {showReview && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="mt-3 bg-white rounded-xl border border-gray-100 overflow-hidden">
                  {/* Tabs */}
                  <div className="flex border-b border-gray-100">
                    <button
                      onClick={() => setReviewTab("unmatched")}
                      className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                        reviewTab === "unmatched"
                          ? "text-[#3D8E62] border-b-2 border-[#3D8E62] bg-[#EEF7F2]/30"
                          : "text-gray-500 hover:text-gray-700"
                      }`}
                    >
                      Unmatched ({unmatchedReceipts.length})
                    </button>
                    <button
                      onClick={() => setReviewTab("matched")}
                      className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                        reviewTab === "matched"
                          ? "text-[#3D8E62] border-b-2 border-[#3D8E62] bg-[#EEF7F2]/30"
                          : "text-gray-500 hover:text-gray-700"
                      }`}
                    >
                      Matched ({matchedReceipts.length})
                    </button>
                  </div>

                  {/* Tab Content */}
                  <div className="divide-y divide-gray-50">
                    {reviewTab === "unmatched" && (
                      <>
                        {unmatchedReceipts.length === 0 ? (
                          <div className="p-8 text-center">
                            <CheckCircle2 className="w-8 h-8 text-[#3D8E62] mx-auto mb-2" />
                            <p className="text-sm text-gray-500">All receipts are matched!</p>
                          </div>
                        ) : (
                          unmatchedReceipts.map((receipt) => (
                            <div key={receipt.id} className="p-4">
                              <div className="flex items-center justify-between">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <h4 className="text-sm font-semibold text-gray-900 truncate">{receipt.merchant}</h4>
                                    <span className="px-2 py-0.5 bg-amber-50 text-amber-600 text-xs rounded-full font-medium shrink-0">
                                      Unmatched
                                    </span>
                                  </div>
                                  <p className="text-xs text-gray-500 mt-0.5">
                                    {new Date(receipt.date).toLocaleDateString()} &bull;{" "}
                                    {formatCurrency(
                                      receipt.currency && receipt.currency !== currencyCode
                                        ? convertCurrency(receipt.amount, receipt.currency, currencyCode)
                                        : receipt.amount,
                                      currencyCode
                                    )}
                                  </p>
                                </div>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (findingMatchFor === receipt.id) {
                                      setFindingMatchFor(null);
                                      setCandidates([]);
                                    } else {
                                      findCandidates(receipt);
                                    }
                                  }}
                                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[#EEF7F2] text-[#3D8E62] hover:bg-[#D1EAE0] transition-colors flex items-center gap-1.5 shrink-0"
                                >
                                  <Search className="w-3 h-3" />
                                  {findingMatchFor === receipt.id ? "Cancel" : "Find Match"}
                                </button>
                              </div>

                              {/* Candidate transactions dropdown */}
                              <AnimatePresence>
                                {findingMatchFor === receipt.id && (
                                  <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: "auto" }}
                                    exit={{ opacity: 0, height: 0 }}
                                    transition={{ duration: 0.15 }}
                                    className="overflow-hidden"
                                  >
                                    <div className="mt-3 bg-gray-50 rounded-lg border border-gray-100 p-3">
                                      <p className="text-xs font-medium text-gray-500 mb-2">Matching transactions:</p>
                                      {loadingCandidates ? (
                                        <div className="flex items-center justify-center py-4">
                                          <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                                          <span className="text-xs text-gray-400 ml-2">Searching...</span>
                                        </div>
                                      ) : candidates.length === 0 ? (
                                        <p className="text-xs text-gray-400 py-3 text-center">
                                          No matching transactions found within 10% amount and 7 days.
                                        </p>
                                      ) : (
                                        <div className="space-y-1.5">
                                          {candidates.map((tx) => (
                                            <div
                                              key={tx.dbId}
                                              className="flex items-center justify-between p-2.5 bg-white rounded-lg border border-gray-100 hover:border-[#3D8E62]/30 transition-colors"
                                            >
                                              <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-gray-900 truncate">{tx.merchant}</p>
                                                <p className="text-xs text-gray-500">
                                                  {tx.dateStr} &bull;{" "}
                                                  {formatCurrency(
                                                    Math.abs(tx.amount),
                                                    tx.isoCurrencyCode || currencyCode
                                                  )}
                                                </p>
                                              </div>
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  matchReceipt(receipt.id, tx.dbId);
                                                }}
                                                disabled={matchingReceipt === receipt.id}
                                                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[#3D8E62] text-white hover:bg-[#2D7A52] disabled:opacity-50 transition-colors flex items-center gap-1 shrink-0"
                                              >
                                                {matchingReceipt === receipt.id ? (
                                                  <Loader2 className="w-3 h-3 animate-spin" />
                                                ) : (
                                                  <ArrowRight className="w-3 h-3" />
                                                )}
                                                Match
                                              </button>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          ))
                        )}
                      </>
                    )}

                    {reviewTab === "matched" && (
                      <>
                        {matchedReceipts.length === 0 ? (
                          <div className="p-8 text-center">
                            <p className="text-sm text-gray-500">No matched receipts yet.</p>
                          </div>
                        ) : (
                          matchedReceipts.map((receipt) => (
                            <div key={receipt.id} className="p-4">
                              <div className="flex items-center justify-between">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <h4 className="text-sm font-semibold text-gray-900 truncate">{receipt.merchant}</h4>
                                    <span className="px-2 py-0.5 bg-[#EEF7F2] text-[#3D8E62] text-xs rounded-full font-medium shrink-0">
                                      Matched
                                    </span>
                                  </div>
                                  <p className="text-xs text-gray-500 mt-0.5">
                                    {new Date(receipt.date).toLocaleDateString()} &bull;{" "}
                                    {formatCurrency(
                                      receipt.currency && receipt.currency !== currencyCode
                                        ? convertCurrency(receipt.amount, receipt.currency, currencyCode)
                                        : receipt.amount,
                                      currencyCode
                                    )}
                                  </p>
                                </div>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    unmatchReceipt(receipt.id);
                                  }}
                                  disabled={matchingReceipt === receipt.id}
                                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700 disabled:opacity-50 transition-colors flex items-center gap-1.5 shrink-0"
                                >
                                  {matchingReceipt === receipt.id ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <Unlink className="w-3 h-3" />
                                  )}
                                  Unmatch
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Receipts List — full width when detail opens in modal */}
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
                    } cursor-pointer transition-all ${compactView ? "p-3" : "p-4"}`}
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className={`flex items-center gap-2 ${compactView ? "mb-0.5" : "mb-1"}`}>
                          <h4 className={`font-semibold text-gray-900 ${compactView ? "text-sm" : ""}`}>{receipt.merchant}</h4>
                          {receipt.transaction_id && (
                            <span className="px-2 py-0.5 bg-[#EEF7F2] text-[#3D8E62] text-xs rounded-full font-medium">
                              Matched
                            </span>
                          )}
                        </div>
                        <p className={`text-gray-500 line-clamp-1 ${compactView ? "text-xs" : "text-sm"}`}>{receipt.raw_subject}</p>
                        <p className={`text-gray-400 ${compactView ? "text-[10px] mt-0.5" : "text-xs mt-1"}`}>
                          {new Date(receipt.date).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className={`font-bold text-gray-900 ${compactView ? "text-base" : "text-lg"}`}>
                          {formatCurrency(
                            receipt.currency && receipt.currency !== currencyCode
                              ? convertCurrency(receipt.amount, receipt.currency, currencyCode)
                              : receipt.amount,
                            currencyCode
                          )}
                        </p>
                        <ChevronRight className="w-4 h-4 text-gray-400 ml-auto mt-1" />
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
        </div>

        {/* Receipt Detail Modal — overlays content, no scroll jump */}
        <AnimatePresence>
          {selectedReceipt && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setSelectedReceipt(null)}
                className="fixed inset-0 bg-black/30 z-40"
              />
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
                className="fixed inset-4 sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-full sm:max-w-lg sm:max-h-[85vh] bg-white rounded-2xl shadow-xl z-50 flex flex-col overflow-hidden"
              >
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
                  <h3 className="text-sm font-semibold text-gray-900">Receipt Details</h3>
                  <button
                    onClick={() => setSelectedReceipt(null)}
                    aria-label="Close"
                    className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500"
                  >
                    <X size={18} />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-6">
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
                              {formatCurrency(
                                selectedReceipt.currency && selectedReceipt.currency !== currencyCode
                                  ? convertCurrency(total, selectedReceipt.currency, currencyCode)
                                  : total,
                                currencyCode
                              )}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-4 pt-4 border-t border-gray-200">
                      <div className="flex justify-between">
                        <p className="text-lg font-semibold text-gray-900">Total</p>
                        <p className="text-lg font-bold text-gray-900">
                          {formatCurrency(
                            selectedReceipt.currency && selectedReceipt.currency !== currencyCode
                              ? convertCurrency(selectedReceipt.amount, selectedReceipt.currency, currencyCode)
                              : selectedReceipt.amount,
                            currencyCode
                          )}
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
                          {formatCurrency(
                            selectedReceipt.currency && selectedReceipt.currency !== currencyCode
                              ? convertCurrency(selectedReceipt.amount, selectedReceipt.currency, currencyCode)
                              : selectedReceipt.amount,
                            currencyCode
                          )}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
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
