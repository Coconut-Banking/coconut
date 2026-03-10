"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";

const SKIP_AUTH = process.env.NEXT_PUBLIC_SKIP_AUTH === "true";

export function AppGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();
  const [plaidStatus, setPlaidStatus] = useState<"checking" | "linked" | "unlinked">("checking");

  // Redirect signed-out users to /login (side-effect, not during render)
  useEffect(() => {
    if (!SKIP_AUTH && isLoaded && !isSignedIn) {
      router.replace("/login");
    }
  }, [isLoaded, isSignedIn, router]);

  useEffect(() => {
    if (SKIP_AUTH || !isLoaded || !isSignedIn) return;
    let cancelled = false;
    fetch("/api/plaid/status")
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setPlaidStatus(data.linked ? "linked" : "unlinked");
      })
      .catch(() => {
        if (!cancelled) setPlaidStatus("unlinked");
      });
    return () => { cancelled = true; };
  }, [isLoaded, isSignedIn]);

  if (!SKIP_AUTH && !isLoaded) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#F7FAF8]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-[#3D8E62]/30 border-t-[#3D8E62] rounded-full animate-spin" />
          <p className="text-sm text-gray-500">Loading...</p>
        </div>
      </div>
    );
  }

  // We already scheduled the redirect in the effect above; just render nothing
  if (!SKIP_AUTH && isLoaded && !isSignedIn) {
    return null;
  }

  if (SKIP_AUTH) {
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
