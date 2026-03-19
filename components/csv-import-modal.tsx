"use client";

import { useState, useRef } from "react";
import { X, Upload, FileText, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface CSVImportModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

type ImportStep = "upload" | "importing" | "results";

interface ImportResult {
  platform: string;
  total: number;
  imported: number;
  skipped: number;
  enriched: number;
  parseErrors: string[];
}

const PLATFORM_OPTIONS = [
  { id: "auto", label: "Auto-detect" },
  { id: "venmo", label: "Venmo" },
  { id: "cashapp", label: "Cash App" },
  { id: "paypal", label: "PayPal" },
];

const PLATFORM_HELP: Record<string, string> = {
  auto: "Upload a CSV export from Venmo, Cash App, or PayPal",
  venmo: "Export from Venmo app \u2192 Settings \u2192 Statements \u2192 Download CSV",
  cashapp: "Export from Cash App \u2192 Activity \u2192 Statements \u2192 Export CSV",
  paypal: "Export from PayPal \u2192 Activity \u2192 Download \u2192 CSV",
};

const PLATFORM_LABELS: Record<string, string> = {
  venmo: "Venmo",
  cashapp: "Cash App",
  paypal: "PayPal",
};

export function CSVImportModal({ onClose, onSuccess }: CSVImportModalProps) {
  const [step, setStep] = useState<ImportStep>("upload");
  const [platform, setPlatform] = useState("auto");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      if (f.size > 5 * 1024 * 1024) {
        setError("File too large (max 5MB)");
        return;
      }
      setFile(f);
      setError(null);
    }
  };

  const handleImport = async () => {
    if (!file) return;
    setStep("importing");
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      if (platform !== "auto") {
        formData.append("platform", platform);
      }

      const res = await fetch("/api/csv-import", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Import failed");
        setStep("upload");
        return;
      }

      setResult(data);
      setStep("results");
      if (data.imported > 0) {
        onSuccess();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
      setStep("upload");
    }
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/30 backdrop-blur-md z-40"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ type: "spring", damping: 30, stiffness: 400 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-gray-100">
          <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
            <h3 className="text-lg font-bold text-gray-900">Import Transactions</h3>
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          <div className="px-6 py-6">
            <AnimatePresence mode="wait">
              {step === "upload" && (
                <motion.div
                  key="upload"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="space-y-4"
                >
                  <div>
                    <label className="text-xs font-medium text-gray-500 mb-2 block">Platform</label>
                    <div className="flex flex-wrap gap-2">
                      {PLATFORM_OPTIONS.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => setPlatform(p.id)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                            platform === p.id
                              ? "border-[#3D8E62] bg-[#EEF7F2] text-[#2D7A52]"
                              : "border-gray-200 text-gray-600 hover:bg-gray-50"
                          }`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <p className="text-xs text-gray-400">{PLATFORM_HELP[platform]}</p>

                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-colors ${
                      file ? "border-[#3D8E62] bg-[#EEF7F2]/50" : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,text/csv"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                    {file ? (
                      <div className="flex items-center justify-center gap-2">
                        <FileText size={18} className="text-[#3D8E62]" />
                        <span className="text-sm font-medium text-[#2D7A52]">{file.name}</span>
                      </div>
                    ) : (
                      <>
                        <Upload size={24} className="text-gray-400 mx-auto mb-2" />
                        <p className="text-sm text-gray-600 mb-1">Click to upload CSV</p>
                        <p className="text-xs text-gray-400">
                          Export your transactions from Venmo, Cash App, or PayPal
                        </p>
                      </>
                    )}
                  </div>

                  {error && (
                    <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-100">
                      <AlertCircle size={14} className="text-red-500 shrink-0 mt-0.5" />
                      <p className="text-sm text-red-700">{error}</p>
                    </div>
                  )}

                  <button
                    onClick={handleImport}
                    disabled={!file}
                    className="w-full py-3 rounded-2xl bg-[#3D8E62] hover:bg-[#2D7A52] disabled:opacity-50 text-white text-sm font-semibold transition-colors"
                  >
                    Import
                  </button>
                </motion.div>
              )}

              {step === "importing" && (
                <motion.div
                  key="importing"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="py-8 text-center"
                >
                  <Loader2 size={32} className="text-[#3D8E62] animate-spin mx-auto mb-4" />
                  <p className="text-sm text-gray-600 font-medium">Importing transactions...</p>
                  <p className="text-xs text-gray-400 mt-1">Parsing and matching to bank records</p>
                </motion.div>
              )}

              {step === "results" && result && (
                <motion.div
                  key="results"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="space-y-4"
                >
                  <div className="text-center py-4">
                    <CheckCircle2 size={32} className="text-[#3D8E62] mx-auto mb-3" />
                    <p className="text-lg font-bold text-gray-900 mb-1">Import complete</p>
                    <p className="text-sm text-gray-500">
                      {PLATFORM_LABELS[result.platform] ?? result.platform} transactions imported
                    </p>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="p-3 rounded-xl bg-gray-50 text-center">
                      <div className="text-xl font-bold text-gray-900">{result.total}</div>
                      <div className="text-xs text-gray-500">Total</div>
                    </div>
                    <div className="p-3 rounded-xl bg-gray-50 text-center">
                      <div className="text-xl font-bold text-gray-900">{result.imported}</div>
                      <div className="text-xs text-gray-500">Imported</div>
                    </div>
                    <div className="p-3 rounded-xl bg-gray-50 text-center">
                      <div className="text-xl font-bold text-[#3D8E62]">{result.enriched}</div>
                      <div className="text-xs text-gray-500">Enriched</div>
                    </div>
                  </div>

                  {result.skipped > 0 && (
                    <p className="text-xs text-gray-400">{result.skipped} rows skipped (duplicates or errors)</p>
                  )}

                  {result.parseErrors.length > 0 && (
                    <details className="text-xs text-gray-400">
                      <summary className="cursor-pointer hover:text-gray-600">
                        {result.parseErrors.length} parse warnings
                      </summary>
                      <ul className="mt-1 space-y-0.5 ml-3">
                        {result.parseErrors.slice(0, 10).map((e, i) => (
                          <li key={i}>{e}</li>
                        ))}
                      </ul>
                    </details>
                  )}

                  <button
                    onClick={onClose}
                    className="w-full py-3 rounded-2xl bg-[#3D8E62] hover:bg-[#2D7A52] text-white text-sm font-semibold transition-colors"
                  >
                    Done
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </>
  );
}
