"use client";

import { useState } from "react";
import { getMerchantLogoDomain } from "@/lib/merchant-logos";
import { formatCurrencyAbs, convertCurrency } from "@/lib/currency";

/** P2P sends (Zelle, Venmo, Cash App TRANSFER_OUT) display as outflow (-) even if amount is positive. */
export function isDisplayAsOutflow(
  amount: number,
  opts?: { category?: string; merchant?: string; rawDescription?: string }
): boolean {
  if (amount <= 0) return false;
  const cat = (opts?.category ?? "").toUpperCase();
  const text = `${opts?.merchant ?? ""} ${opts?.rawDescription ?? ""}`.toLowerCase();
  const isTransferOut = cat.includes("TRANSFER") && cat.includes("OUT");
  const looksLikeP2PSend = /zelle|venmo|cash\s*app/i.test(text);
  if (isTransferOut && looksLikeP2PSend) return true;
  // Rideshare/transportation (Uber, Lyft) are always expenses — never show green
  const isTransport = cat.includes("TRANSPORTATION") || /uber|lyft|rideshare|taxi/i.test(text);
  return !!isTransport;
}

/** Credit card payments (TRANSFER_OUT reducing debt) display as positive/green like income. */
export function isDisplayAsInflow(
  amount: number,
  opts?: { category?: string; merchant?: string; rawDescription?: string }
): boolean {
  if (isDisplayAsOutflow(amount, opts)) return false;
  if (amount > 0) return true;
  if (!opts) return false;
  const cat = (opts.category ?? "").toUpperCase();
  const merchant = (opts.merchant ?? opts.rawDescription ?? "").toLowerCase();
  const raw = (opts.rawDescription ?? "").toLowerCase();
  const isTransferOut = cat.includes("TRANSFER") && cat.includes("OUT");
  const looksLikeCardPayment =
    /credit\s*card|card\s*payment|payment\s*to|autopay|pay\s*\d|payment\s*[- ]?credit|^payment$/i.test(merchant) ||
    /credit\s*card|card\s*payment|payment\s*to|autopay|payment\s*[- ]?credit/i.test(raw);
  return !!(isTransferOut && looksLikeCardPayment);
}

/** Format amount with + / - . Only inflows (+) get green; outflows stay neutral. */
export function AmountDisplay({
  amount,
  className = "",
  currencyCode,
  isoCurrencyCode,
  treatAsInflow,
  category,
  merchant,
  rawDescription,
}: {
  amount: number;
  className?: string;
  currencyCode?: string;
  isoCurrencyCode?: string;
  /** Override: treat as inflow (green +) e.g. for credit card payments */
  treatAsInflow?: boolean;
  category?: string;
  merchant?: string;
  rawDescription?: string;
}) {
  const displayCode = currencyCode || "USD";
  const txCode = isoCurrencyCode || "USD";
  const displayAmount =
    txCode !== displayCode ? convertCurrency(amount, txCode, displayCode) : amount;
  const isInflow =
    treatAsInflow ?? isDisplayAsInflow(amount, { category, merchant, rawDescription });
  const sign = isInflow ? "+" : "-";
  return (
    <span
      className={
        isInflow
          ? `font-semibold text-emerald-600 ${className}`
          : `font-semibold text-gray-900 ${className}`
      }
    >
      {sign}{formatCurrencyAbs(displayAmount, displayCode)}
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
