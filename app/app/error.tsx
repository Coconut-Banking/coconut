"use client";

import { useEffect } from "react";

/**
 * Catches errors inside the authenticated app shell (/app/*).
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      console.error("[app-error]", error);
    }
    // Wire @sentry/nextjs captureException here when SENTRY_DSN is configured.
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center p-6 bg-[#F5F3F2]">
      <h2 className="text-lg font-semibold text-[#1e2021]">Something went wrong</h2>
      <p className="mt-2 text-sm text-gray-600 text-center max-w-md">
        This page hit an error. Your data is safe — try reloading this section.
      </p>
      <button
        type="button"
        onClick={() => reset()}
        className="mt-6 px-5 py-2.5 bg-[#1e2021] hover:bg-[#161819] text-white text-sm font-medium rounded-xl"
      >
        Try again
      </button>
    </div>
  );
}
