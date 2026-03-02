"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";

const DEMO_KEY = "coconut_demo";

export function useDemoMode(): boolean {
  const [isDemo, setIsDemo] = useState(false);
  useEffect(() => {
    setIsDemo(typeof window !== "undefined" && localStorage.getItem(DEMO_KEY) === "true");
  }, []);
  return isDemo;
}

export function setDemoMode(enabled: boolean): void {
  if (typeof window === "undefined") return;
  if (enabled) localStorage.setItem(DEMO_KEY, "true");
  else localStorage.removeItem(DEMO_KEY);
}

export function AppGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();
  const [plaidStatus, setPlaidStatus] = useState<"checking" | "linked" | "unlinked">("checking");

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    fetch("/api/plaid/status")
      .then((res) => res.json())
      .then((data) => setPlaidStatus(data.linked ? "linked" : "unlinked"))
      .catch(() => setPlaidStatus("unlinked"));
  }, [isLoaded, isSignedIn]);

  // Clerk middleware handles unauthenticated redirect, but handle loading state here
  if (!isLoaded) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#F7FAF8]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-[#3D8E62]/30 border-t-[#3D8E62] rounded-full animate-spin" />
          <p className="text-sm text-gray-500">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    router.replace("/login");
    return null;
  }

  // Signed in — check if they have Plaid linked or are in demo mode
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

  const isDemo = typeof window !== "undefined" && localStorage.getItem(DEMO_KEY) === "true";

  if (plaidStatus === "unlinked" && !isDemo) {
    router.replace("/connect");
    return null;
  }

  return <>{children}</>;
}
