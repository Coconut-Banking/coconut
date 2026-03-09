"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";

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
    router.replace("/connect");
    return null;
  }

  return <>{children}</>;
}
