"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useEffect, useCallback } from "react";
import { Shield, Lock, CheckCircle2, ArrowLeft, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { usePlaidLink } from "react-plaid-link";
import { setDemoMode } from "@/components/AppGate";

type Step = "link" | "connected";

export default function ConnectBankPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("link");
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isExchanging, setIsExchanging] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/plaid/create-link-token", { method: "POST" })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setError(data.error);
          return;
        }
        setLinkToken(data.link_token ?? null);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message ?? "Failed to load");
      });
    return () => { cancelled = true; };
  }, []);

  const onSuccess = useCallback(
    async (publicToken: string) => {
      setIsExchanging(true);
      setError(null);
      try {
        const res = await fetch("/api/plaid/exchange-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ public_token: publicToken }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Failed to connect");
          return;
        }
        setStep("connected");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to connect");
      } finally {
        setIsExchanging(false);
      }
    },
    []
  );

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
    onExit: (err) => {
      if (err) setError((err as { errorMessage?: string })?.errorMessage ?? "Link exited");
    },
  });

  return (
    <div className="min-h-screen bg-[#F7FAF8] flex flex-col">
      <div className="px-8 py-5 flex items-center gap-4 border-b border-gray-100 bg-white">
        <Link
          href="/login"
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
        >
          <ArrowLeft size={16} />
          Back
        </Link>
        <div className="flex items-center gap-2.5 mx-auto">
          <div className="w-6 h-6 rounded-md bg-[#3D8E62] flex items-center justify-center">
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
              <path d="M7 2C7 2 3 4.5 3 8C3 10.2 4.8 12 7 12C9.2 12 11 10.2 11 8C11 4.5 7 2 7 2Z" fill="white"/>
            </svg>
          </div>
          <span className="text-sm font-semibold text-gray-700">Coconut</span>
        </div>
        <div className="w-12" />
      </div>

      <div className="flex-1 flex items-start justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <AnimatePresence mode="wait">
            {step === "link" && (
              <motion.div
                key="link"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.3 }}
              >
                <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                  <div className="px-6 pt-6 pb-4 border-b border-gray-100">
                    <h1 className="text-xl font-bold text-gray-900 mb-1">Connect your bank</h1>
                    <p className="text-sm text-gray-500">
                      Securely connect your accounts via Plaid. Coconut never stores your credentials.
                    </p>
                  </div>
                  <div className="px-6 py-6">
                    {error && (
                      <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-100 text-sm text-red-700">
                        {error}
                      </div>
                    )}
                    {linkToken ? (
                      <>
                        <button
                          type="button"
                          onClick={() => open()}
                          disabled={!ready || isExchanging}
                          className="w-full bg-[#3D8E62] hover:bg-[#2D7A52] disabled:opacity-70 text-white py-3 rounded-xl text-sm font-medium transition-all duration-200 flex items-center justify-center gap-2"
                        >
                          {isExchanging ? (
                            <>
                              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                              Connecting...
                            </>
                          ) : (
                            <>
                              Link your bank with Plaid
                              <ChevronRight size={15} />
                            </>
                          )}
                        </button>
                        <p className="text-xs text-gray-400 mt-4 text-center">
                          Sandbox: use <strong>user_good</strong> / <strong>pass_good</strong> to test
                        </p>
                      </>
                    ) : (
                      <div className="text-center py-4">
                        {error ? (
                          <p className="text-sm text-gray-500">Could not load Plaid. Check your env and try again.</p>
                        ) : (
                          <div className="w-6 h-6 border-2 border-[#3D8E62]/30 border-t-[#3D8E62] rounded-full animate-spin mx-auto" />
                        )}
                      </div>
                    )}
                  </div>
                  <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-center gap-4">
                    <div className="flex items-center gap-1.5 text-xs text-gray-400">
                      <Shield size={12} className="text-[#3D8E62]" /> 256-bit encryption
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-gray-400">
                      <Lock size={12} className="text-[#3D8E62]" /> Read-only access
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {step === "connected" && (
              <motion.div
                key="connected"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4 }}
              >
                <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden text-center px-8 py-10">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", delay: 0.1, stiffness: 200 }}
                    className="w-16 h-16 rounded-full bg-[#EEF7F2] flex items-center justify-center mx-auto mb-4"
                  >
                    <CheckCircle2 size={32} className="text-[#3D8E62]" />
                  </motion.div>
                  <h2 className="text-xl font-bold text-gray-900 mb-2">Bank connected!</h2>
                  <p className="text-sm text-gray-500 mb-6">
                    We&apos;re importing your transactions. This usually takes under a minute.
                  </p>
                  <button
                    onClick={() => {
                      setDemoMode(false);
                      router.push("/app/dashboard");
                    }}
                    className="w-full bg-[#3D8E62] hover:bg-[#2D7A52] text-white py-2.5 rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    View your dashboard
                    <ChevronRight size={15} />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
