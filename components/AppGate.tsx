"use client";

import { createContext, useContext, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";

const SKIP_AUTH =
  process.env.NODE_ENV !== "production" &&
  process.env.NEXT_PUBLIC_SKIP_AUTH === "true";

const CLERK_DISABLED = process.env.NEXT_PUBLIC_CLERK_DISABLED === "true";

const BYPASS_AUTH = SKIP_AUTH || CLERK_DISABLED;

export type PlaidStatus = "checking" | "linked" | "unlinked";
export const PlaidStatusContext = createContext<PlaidStatus>("checking");
export const usePlaidStatus = () => useContext(PlaidStatusContext);

export function AppGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();
  const [plaidStatus, setPlaidStatus] = useState<PlaidStatus>("checking");
  const [authLoadTimeout, setAuthLoadTimeout] = useState(false);

  // Redirect signed-out users to /login
  useEffect(() => {
    if (!BYPASS_AUTH && isLoaded && !isSignedIn) {
      router.replace("/login");
    }
  }, [isLoaded, isSignedIn, router]);

  // Check Plaid status in the background — does NOT block rendering
  useEffect(() => {
    if (BYPASS_AUTH || !isLoaded || !isSignedIn) return;
    let cancelled = false;
    const timeout = setTimeout(() => {
      if (!cancelled) setPlaidStatus("unlinked");
    }, 5000);
    fetch("/api/plaid/status")
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setPlaidStatus(data.linked ? "linked" : "unlinked");
      })
      .catch(() => {
        if (!cancelled) setPlaidStatus("unlinked");
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [isLoaded, isSignedIn]);

  // Redirect unlinked users to /connect (effect, not blocking render)
  useEffect(() => {
    if (plaidStatus === "unlinked") {
      router.replace("/connect");
    }
  }, [plaidStatus, router]);

  // Auth timeout — redirect to login if Clerk never resolves
  useEffect(() => {
    if (BYPASS_AUTH || isLoaded) return;
    const t = setTimeout(() => setAuthLoadTimeout(true), 8000);
    return () => clearTimeout(t);
  }, [isLoaded]);

  useEffect(() => {
    if (authLoadTimeout && !BYPASS_AUTH && !isLoaded) {
      router.replace("/login");
    }
  }, [authLoadTimeout, BYPASS_AUTH, isLoaded, router]);

  // Only block on Clerk auth loading — not on Plaid status
  if (!BYPASS_AUTH && !isLoaded) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#F5F3F2]">
        <div className="flex flex-col items-center gap-4">
          {!authLoadTimeout ? (
            <>
              <div className="w-8 h-8 border-2 border-[#1e2021]/30 border-t-[#1e2021] rounded-full animate-spin" />
              <p className="text-sm text-gray-500">Loading...</p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-gray-700">Taking too long?</p>
              <p className="text-xs text-gray-500 text-center max-w-xs">
                Check your connection or try again. If the app is in a browser within another app, try opening it in Safari.
              </p>
              <div className="mt-4 flex flex-col gap-2">
                <a
                  href="/login"
                  className="inline-flex items-center justify-center px-5 py-2.5 bg-[#1e2021] hover:bg-[#161819] text-white text-sm font-medium rounded-xl transition-colors"
                >
                  Go to Login
                </a>
                <button
                  onClick={() => window.location.reload()}
                  className="text-sm text-[#1e2021] hover:text-[#161819] font-medium"
                >
                  Reload
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  if (!BYPASS_AUTH && isLoaded && !isSignedIn) {
    return null;
  }

  return (
    <PlaidStatusContext.Provider value={plaidStatus}>
      {children}
    </PlaidStatusContext.Provider>
  );
}
