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
    }, 8000);
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
  useEffect(() => {
    if (BYPASS_AUTH || isLoaded) return;
    const t = setTimeout(() => setAuthLoadTimeout(true), 12000);
    return () => clearTimeout(t);
  }, [isLoaded]);

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
              <button
                onClick={() => window.location.reload()}
                className="mt-2 text-sm text-[#3D8E62] hover:text-[#2D7A52] font-medium"
              >
                Reload
              </button>
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
