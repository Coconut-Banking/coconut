"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { Shield, Lock, CheckCircle2, ArrowLeft, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { usePlaidLink } from "react-plaid-link";

type Step = "link" | "connected";

const APP_DEEP_LINK = "coconut://";
const TRACE_STORAGE_KEY = "plaid_connect_trace_id";

function makeTraceId(): string {
  return `plaid_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function ConnectedStep() {
  const router = useRouter();
  const fromApp =
    (typeof window !== "undefined" && sessionStorage.getItem("connect_from_app") === "1") ||
    false;

  useEffect(() => {
    if (fromApp) {
      const t = setTimeout(() => {
        sessionStorage.removeItem("connect_from_app");
        window.location.href = `${APP_DEEP_LINK}connected`;
      }, 1500);
      return () => clearTimeout(t);
    }
  }, [fromApp]);

  return (
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
        {fromApp ? (
          <a
            href={`${APP_DEEP_LINK}connected`}
            className="block w-full bg-[#3D8E62] hover:bg-[#2D7A52] text-white py-2.5 rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            Return to app
            <ChevronRight size={15} />
          </a>
        ) : (
          <button
            onClick={() => router.push("/app/dashboard")}
            className="w-full bg-[#3D8E62] hover:bg-[#2D7A52] text-white py-2.5 rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            View your dashboard
            <ChevronRight size={15} />
          </button>
        )}
      </div>
    </motion.div>
  );
}

function ConnectBankContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<Step>("link");
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [isSandbox, setIsSandbox] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<string | null>(null);
  const [isExchanging, setIsExchanging] = useState(false);
  const [traceId, setTraceId] = useState("");
  const [loginRedirectUrl, setLoginRedirectUrl] = useState<string | null>(null);
  const [showLoginRetry, setShowLoginRetry] = useState(false);

  const logPlaidEvent = useCallback(
    (payload: Record<string, unknown>) => {
      fetch("/api/plaid/link-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trace_id: traceId || null,
          source: searchParams.get("from_app") === "1" ? "app" : "web",
          context: "connect",
          ...payload,
        }),
      }).catch(() => {
        // best effort logging only
      });
    },
    [searchParams, traceId]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const existing = sessionStorage.getItem(TRACE_STORAGE_KEY);
    const id = existing || makeTraceId();
    if (!existing) sessionStorage.setItem(TRACE_STORAGE_KEY, id);
    setTraceId(id);
  }, []);

  useEffect(() => {
    if (!traceId) return;
    logPlaidEvent({
      type: "connect_page_loaded",
      metadata: {
        href: typeof window !== "undefined" ? window.location.href : null,
        from_app: searchParams.get("from_app") === "1",
        via_login: searchParams.get("via_login") === "1",
        has_oauth_state_id: Boolean(searchParams.get("oauth_state_id")),
      },
    });
  }, [logPlaidEvent, searchParams, traceId]);

  // OAuth return: Plaid redirects back with oauth_state_id — pass to Link for redirect flow
  const receivedRedirectUri =
    typeof window !== "undefined" && searchParams.get("oauth_state_id")
      ? window.location.href
      : undefined;

  // Preserve from_app across OAuth redirect (Plaid redirect drops query params)
  useEffect(() => {
    if (typeof window !== "undefined" && searchParams.get("from_app") === "1") {
      sessionStorage.setItem("connect_from_app", "1");
    }
  }, [searchParams]);

  // When from_app=1: always go through login first so both simulator and phone get same flow.
  // Safari on phone may have stale session from a different account; login ensures correct account.
  // Redirect URL includes via_login=1 so we don't redirect again when they return.
  useEffect(() => {
    const fromApp = searchParams.get("from_app") === "1";
    const viaLogin = searchParams.get("via_login") === "1";
    if (fromApp && !viaLogin) {
      const redirectBack = "/connect?from_app=1&via_login=1";
      window.location.href = `/login?redirect_url=${encodeURIComponent(redirectBack)}`;
      return;
    }
  }, [searchParams]);

  useEffect(() => {
    const fromApp = searchParams.get("from_app") === "1";
    const viaLogin = searchParams.get("via_login") === "1";
    if (fromApp && !viaLogin) return; // Redirect handled above, don't fetch

    let cancelled = false;
    const redirectBack = `/connect${fromApp ? "?from_app=1&via_login=1" : ""}`;
    setLoginRedirectUrl(`/login?redirect_url=${encodeURIComponent(redirectBack)}`);
    setShowLoginRetry(false);

    const isUpdateMode = searchParams.get("update") === "1";
    const newAccounts = searchParams.get("new_accounts") === "1";
    fetch("/api/plaid/create-link-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trace_id: traceId || null, update: isUpdateMode, new_accounts: newAccounts }),
    })
      .then((res) => {
        if (res.status === 401) {
          // Avoid infinite login bounce loops on iOS webviews/session races.
          setError("Your session isn't ready yet. Please sign in again.");
          setDebugInfo("create-link-token returned 401");
          setShowLoginRetry(true);
          logPlaidEvent({
            type: "create_link_token_unauthorized",
            error: { message: "401 Unauthorized" },
          });
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (cancelled || !data) return;
        if (data.error) {
          const debugHint =
            data._debug?.redirect_uri
              ? `\n\nExact URI we sent: "${data._debug.redirect_uri}"`
              : "";
          setError(data.error + debugHint);
          setDebugInfo(
            data._debug?.redirect_uri
              ? `redirect_uri=${data._debug.redirect_uri}`
              : null
          );
          logPlaidEvent({
            type: "create_link_token_error",
            error: { message: data.error },
            debug: data._debug ?? null,
          });
          return;
        }
        setLinkToken(data.link_token ?? null);
        setIsSandbox(data.plaid_env !== "production");
        setDebugInfo(
          data._debug?.redirect_uri
            ? `redirect_uri=${data._debug.redirect_uri}`
            : null
        );
        logPlaidEvent({
          type: "create_link_token_ok",
          debug: data._debug ?? null,
        });
      })
      .catch((err) => {
        if (!cancelled) {
          const msg = err.message ?? "Failed to load";
          setError(msg);
          logPlaidEvent({
            type: "create_link_token_exception",
            error: { message: msg },
          });
        }
      });
    return () => { cancelled = true; };
  }, [searchParams, traceId, logPlaidEvent]);

  const isUpdateMode = searchParams.get("update") === "1";
  const onSuccess = useCallback(
    async (publicToken: string, metadata?: unknown) => {
      setIsExchanging(true);
      setError(null);
      try {
        const meta = metadata as {
          linkSessionId?: string;
          institution?: { institution_id?: string };
          accounts?: { id: string }[];
        } | undefined;
        const plaidIds = {
          link_session_id: meta?.linkSessionId ?? null,
          account_ids: (meta?.accounts ?? []).map((a) => a.id),
        };
        logPlaidEvent({
          type: "link_success",
          metadata: { ...(metadata as object), plaid_ids: plaidIds },
        });
        if (isUpdateMode) {
          // Update mode: access_token unchanged, no exchange needed. Dismiss prompts.
          fetch("/api/plaid/clear-alerts", { method: "POST" }).catch(() => {});
          setStep("connected");
          logPlaidEvent({
            type: "update_mode_ok",
            metadata: {
              institution_id: meta?.institution?.institution_id ?? null,
              plaid_ids: plaidIds,
            },
          });
        } else {
          const res = await fetch("/api/plaid/exchange-token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ public_token: publicToken, trace_id: traceId || null }),
          });
          const data = await res.json();
          if (!res.ok) {
            setError(data.error ?? "Failed to connect");
            logPlaidEvent({
              type: "exchange_token_error",
              error: data ?? null,
            });
            return;
          }
          setStep("connected");
          logPlaidEvent({
            type: "exchange_token_ok",
            metadata: {
              synced: data?.synced ?? null,
              item_id: data?.item_id ?? null,
              plaid_ids: plaidIds,
            },
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to connect";
        setError(msg);
        logPlaidEvent({
          type: "exchange_token_exception",
          error: { message: msg },
        });
      } finally {
        setIsExchanging(false);
      }
    },
    [logPlaidEvent, traceId, isUpdateMode]
  );

  const { open, ready } = usePlaidLink({
    token: linkToken,
    receivedRedirectUri,
    onSuccess,
    onEvent: (eventName, metadata) => {
      logPlaidEvent({
        type: "link_event",
        metadata: { eventName, metadata },
      });
    },
    onExit: (err) => {
      if (err) {
        const e = err as {
          errorCode?: string;
          errorType?: string;
          errorMessage?: string;
          displayMessage?: string | null;
          requestId?: string | null;
        };
        const msg = e.displayMessage || e.errorMessage || "Link exited";
        setError(msg);
        const detail = [
          e.errorCode ? `error_code=${e.errorCode}` : null,
          e.errorType ? `error_type=${e.errorType}` : null,
          e.requestId ? `request_id=${e.requestId}` : null,
        ]
          .filter(Boolean)
          .join(", ");
        setDebugInfo(detail || null);
        logPlaidEvent({
          type: "link_exit_error",
          error: {
            message: msg,
            error_code: e.errorCode ?? null,
            error_type: e.errorType ?? null,
            request_id: e.requestId ?? null,
          },
        });
      } else {
        logPlaidEvent({ type: "link_exit_no_error" });
      }
    },
  });

  const hasAutoOpened = useRef(false);
  useEffect(() => {
    if (receivedRedirectUri && linkToken && ready && !hasAutoOpened.current) {
      hasAutoOpened.current = true;
      logPlaidEvent({
        type: "link_auto_open_after_oauth",
        metadata: { receivedRedirectUri },
      });
      open();
    }
  }, [receivedRedirectUri, linkToken, ready, open, logPlaidEvent]);

  return (
    <div className="min-h-screen bg-[#F7FAF8] flex flex-col">
      <div className="px-8 py-5 flex items-center gap-4 border-b border-gray-100 bg-white">
        <button
          type="button"
          onClick={() => {
            if (typeof window !== "undefined" && window.history.length > 1) {
              router.back();
            } else {
              router.push("/app/settings");
            }
          }}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
        >
          <ArrowLeft size={16} />
          Back
        </button>
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
                        <p>{error}</p>
                        {debugInfo ? (
                          <p className="mt-1 text-xs text-red-600 break-all">
                            {debugInfo}
                          </p>
                        ) : null}
                        {traceId ? (
                          <p className="mt-1 text-xs text-red-600 break-all">trace_id={traceId}</p>
                        ) : null}
                        {showLoginRetry && loginRedirectUrl ? (
                          <a
                            href={loginRedirectUrl}
                            className="mt-3 inline-flex items-center rounded-lg bg-red-600 px-3 py-2 text-xs font-medium text-white hover:bg-red-700"
                          >
                            Sign in again
                          </a>
                        ) : null}
                      </div>
                    )}
                    {linkToken ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            logPlaidEvent({ type: "link_open_clicked" });
                            open();
                          }}
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
                        {isSandbox && (
                          <p className="text-xs text-gray-400 mt-4 text-center">
                            Sandbox: use <strong>user_good</strong> / <strong>pass_good</strong> to test
                          </p>
                        )}
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
              <ConnectedStep />
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function ConnectFallback() {
  const router = useRouter();
  return (
    <div className="min-h-screen bg-[#F7FAF8] flex flex-col">
      <div className="px-8 py-5 flex items-center gap-4 border-b border-gray-100 bg-white">
        <button
          type="button"
          onClick={() => {
            if (typeof window !== "undefined" && window.history.length > 1) {
              router.back();
            } else {
              router.push("/app/settings");
            }
          }}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
        >
          <ArrowLeft size={16} /> Back
        </button>
        <div className="flex-1" />
      </div>
      <div className="flex-1 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[#3D8E62]/30 border-t-[#3D8E62] rounded-full animate-spin" />
      </div>
    </div>
  );
}

export default function ConnectBankPage() {
  return (
    <Suspense fallback={<ConnectFallback />}>
      <ConnectBankContent />
    </Suspense>
  );
}
