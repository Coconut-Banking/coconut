"use client";

import { useRouter } from "next/navigation";

export function DemoButton() {
  const router = useRouter();

  return (
    <button
      onClick={async () => {
        await fetch("/api/demo", { method: "POST" });
        router.push("/app/dashboard");
      }}
      className="text-sm text-gray-500 hover:text-[#1e2021] font-medium transition-colors"
    >
      Or try the demo account →
    </button>
  );
}
