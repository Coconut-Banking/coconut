/**
 * App Store marketing button — link must point to your App Store / TestFlight URL (NEXT_PUBLIC_IOS_APP_URL).
 */
export function AppStoreBadge({
  href,
  className = "",
}: {
  href: string;
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`group inline-flex items-center gap-3.5 rounded-2xl bg-white px-5 py-3.5 text-neutral-900 shadow-[0_16px_48px_-12px_rgba(0,0,0,0.55)] ring-1 ring-white/20 transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_24px_64px_-16px_rgba(0,0,0,0.6)] ${className}`}
    >
      <svg
        aria-hidden
        className="h-9 w-9 shrink-0 text-neutral-900"
        viewBox="0 0 24 24"
        fill="currentColor"
      >
        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
      </svg>
      <div className="text-left leading-none">
        <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-neutral-500">
          Download on the
        </span>
        <span className="font-display mt-0.5 block text-[1.35rem] font-semibold tracking-tight">App Store</span>
      </div>
    </a>
  );
}
