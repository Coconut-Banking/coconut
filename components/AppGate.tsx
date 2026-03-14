"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";

const SKIP_AUTH =
  process.env.NODE_ENV !== "production" &&
  process.env.NEXT_PUBLIC_SKIP_AUTH === "true";

const CLERK_DISABLED = process.env.NEXT_PUBLIC_CLERK_DISABLED === "true";

const BYPASS_AUTH = SKIP_AUTH || CLERK_DISABLED;

export function AppGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();
  const [plaidStatus, setPlaidStatus] = useState<"checking" | "linked" | "unlinked">("checking");

  // Redirect signed-out users to /login (side-effect, not during render)
  useEffect(() => {
    if (!BYPASS_AUTH && isLoaded && !isSignedIn) {
      router.replace("/login");
    }
  }, [isLoaded, isSignedIn, router]);

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

  const [authLoadTimeout, setAuthLoadTimeout] = useState(false);
  const [plaidCheckSlow, setPlaidCheckSlow] = useState(false);
  useEffect(() => {
    if (BYPASS_AUTH || isLoaded) return;
    const t = setTimeout(() => setAuthLoadTimeout(true), 8000);
    return () => clearTimeout(t);
  }, [isLoaded]);

  // Show escape hatch if plaid check takes > 4 seconds
  useEffect(() => {
    if (plaidStatus !== "checking") return;
    const t = setTimeout(() => setPlaidCheckSlow(true), 4000);
    return () => clearTimeout(t);
  }, [plaidStatus]);

  // When auth times out, redirect to login so user isn't stuck on spinner
  useEffect(() => {
    if (authLoadTimeout && !BYPASS_AUTH && !isLoaded) {
      router.replace("/login");
    }
  }, [authLoadTimeout, BYPASS_AUTH, isLoaded, router]);

  if (!BYPASS_AUTH && !isLoaded) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#F7FAF8]">
        <div className="flex flex-col items-center gap-4">
          {!authLoadTimeout ? (
            <>
              <div className="w-8 h-8 border-2 border-[#3D8E62]/30 border-t-[#3D8E62] rounded-full animate-spin" />
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
                  className="inline-flex items-center justify-center px-5 py-2.5 bg-[#3D8E62] hover:bg-[#2D7A52] text-white text-sm font-medium rounded-xl transition-colors"
                >
                  Go to Login
                </a>
                <button
                  onClick={() => window.location.reload()}
                  className="text-sm text-[#3D8E62] hover:text-[#2D7A52] font-medium"
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

  // We already scheduled the redirect in the effect above; just render nothing
  if (!BYPASS_AUTH && isLoaded && !isSignedIn) {
    return null;
  }

  if (BYPASS_AUTH) {
    return <>{children}</>;
  }

  if (plaidStatus === "checking") {
    return (
      <div className="flex h-screen items-center justify-center bg-[#F7FAF8]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-[#3D8E62]/30 border-t-[#3D8E62] rounded-full animate-spin" />
          <p className="text-sm text-gray-500">Loading your data...</p>
          {plaidCheckSlow && (
            <a
              href="/login"
              className="mt-2 text-sm text-[#3D8E62] hover:text-[#2D7A52] font-medium underline"
            >
              Having trouble? Go to Login
            </a>
          )}
        </div>
      </div>
    );
  }

  if (plaidStatus === "unlinked") {
    // We still want new users to go through connect, but to avoid React warnings
    // we navigate from a microtask instead of during render.
    Promise.resolve().then(() => {
      router.replace("/connect");
    });
    return null;
  }

  return <>{children}</>;
}
