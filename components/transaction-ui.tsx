"use client";

import { useState } from "react";
import { getMerchantLogoDomain } from "@/lib/merchant-logos";

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

/** Letter avatar fallback when no logo or load fails. */
function LetterAvatar({ name, size = "sm" }: { name: string; size?: "sm" | "lg" }) {
  const dim = size === "lg" ? "w-14 h-14" : "w-9 h-9";
  const textSize = size === "lg" ? "text-xl" : "text-sm";
  return (
    <div
      className={`${dim} rounded-xl flex items-center justify-center bg-gray-200 text-gray-600 font-semibold shrink-0 ${textSize}`}
    >
      {(name[0] || "?").toUpperCase()}
    </div>
  );
}

/** Logo for allowlisted merchants; letter avatar for others or on load fail. */
export function MerchantLogo({ name, size = "sm" }: { name: string; color?: string; size?: "sm" | "lg" }) {
  const domain = getMerchantLogoDomain(name);
  const [imgError, setImgError] = useState(false);

  if (!domain || imgError) return <LetterAvatar name={name} size={size} />;

  const dim = size === "lg" ? "w-14 h-14" : "w-9 h-9";
  const sz = size === "lg" ? 128 : 64;
  return (
    <div className={`${dim} rounded-xl overflow-hidden flex items-center justify-center bg-gray-100 shrink-0`}>
      <img
        src={`https://www.google.com/s2/favicons?domain=${domain}&sz=${sz}`}
        alt=""
        className={size === "lg" ? "w-10 h-10" : "w-7 h-7"}
        onError={() => setImgError(true)}
      />
    </div>
  );
}
