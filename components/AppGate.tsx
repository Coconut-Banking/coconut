"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

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
  const [status, setStatus] = useState<"checking" | "allowed" | "denied">("checking");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/plaid/status")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.linked) {
          setStatus("allowed");
          return;
        }
        const isDemo = typeof window !== "undefined" && localStorage.getItem(DEMO_KEY) === "true";
        setStatus(isDemo ? "allowed" : "denied");
      })
      .catch(() => {
        if (!cancelled) {
          const isDemo = typeof window !== "undefined" && localStorage.getItem(DEMO_KEY) === "true";
          setStatus(isDemo ? "allowed" : "denied");
        }
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (status !== "denied") return;
    router.replace("/");
  }, [status, router]);

  if (status === "checking") {
    return (
      <div className="flex h-screen items-center justify-center bg-[#F7FAF8]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-[#3D8E62]/30 border-t-[#3D8E62] rounded-full animate-spin" />
          <p className="text-sm text-gray-500">Loading...</p>
        </div>
      </div>
    );
  }

  if (status === "denied") {
    return null;
  }

  return <>{children}</>;
}
