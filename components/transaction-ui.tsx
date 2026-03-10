"use client";

import { useState } from "react";

/** Guess domain from merchant name for logo lookup. */
export function merchantToDomain(merchant: string): string | null {
  const cleaned = merchant
    .replace(/\s*#\d+.*$/i, "")
    .replace(/\s*\d{4,}.*$/i, "")
    .replace(/\s*\*.*$/i, "")
    .trim();
  const tokens = cleaned.split(/[\s\-&'.,]+/).filter((t) => t.length >= 2 && !/^\d+$/.test(t));
  const first = tokens[0];
  if (!first) return null;
  const slug = first.toLowerCase().replace(/[^a-z0-9]/g, "");
  return slug.length >= 2 ? `${slug}.com` : null;
}

/** Format amount with + / - . Only inflows (+) get green; outflows stay neutral. */
export function AmountDisplay({ amount, className = "" }: { amount: number; className?: string }) {
  const isInflow = amount > 0;
  const sign = isInflow ? "+" : "-";
  const abs = Math.abs(amount);
  return (
    <span
      className={
        isInflow
          ? `font-semibold text-emerald-600 ${className}`
          : `font-semibold text-gray-900 ${className}`
      }
    >
      {sign}${abs.toFixed(2)}
    </span>
  );
}

export function MerchantLogo({ name, color, size = "sm" }: { name: string; color: string; size?: "sm" | "lg" }) {
  const domain = merchantToDomain(name);
  const [failed, setFailed] = useState(false);
  const useFallback = !domain || failed;
  const dim = size === "lg" ? "w-14 h-14" : "w-9 h-9";
  const textSize = size === "lg" ? "text-xl" : "text-sm";

  const fallback = (
    <div
      className={`${dim} rounded-xl flex items-center justify-center text-white font-bold shrink-0 ${textSize}`}
      style={{ backgroundColor: color }}
    >
      {name[0]}
    </div>
  );

  if (useFallback) return fallback;

  // Google Favicon API: free, no key, domain → favicon (widely used fallback for Clearbit)
  return (
    <div className={`${dim} rounded-xl overflow-hidden shrink-0 flex items-center justify-center bg-gray-100`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`https://www.google.com/s2/favicons?domain=${domain}&sz=128`}
        alt=""
        className="w-full h-full object-contain"
        onError={() => setFailed(true)}
      />
    </div>
  );
}
