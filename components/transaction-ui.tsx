"use client";

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

/** Letter avatar — no external favicon calls (avoids 404 spam from bad domain guesses). */
export function MerchantLogo({ name, color, size = "sm" }: { name: string; color: string; size?: "sm" | "lg" }) {
  const dim = size === "lg" ? "w-14 h-14" : "w-9 h-9";
  const textSize = size === "lg" ? "text-xl" : "text-sm";
  return (
    <div
      className={`${dim} rounded-xl flex items-center justify-center text-white font-bold shrink-0 ${textSize}`}
      style={{ backgroundColor: color }}
    >
      {name[0]}
    </div>
  );
}
