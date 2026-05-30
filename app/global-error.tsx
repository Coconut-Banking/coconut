"use client";

/**
 * Catches errors in the root layout. Reports can be wired to Sentry when configured.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col items-center justify-center bg-[#F5F3F2] p-6 font-sans">
        <h1 className="text-lg font-semibold text-[#1e2021]">Something went wrong</h1>
        <p className="mt-2 text-sm text-gray-600 text-center max-w-md">
          An unexpected error occurred. Try again or return to the home page.
        </p>
        {process.env.NODE_ENV !== "production" && error.message ? (
          <pre className="mt-4 max-w-lg overflow-auto rounded-xl bg-white p-4 text-xs text-gray-700 border border-gray-200">
            {error.message}
          </pre>
        ) : null}
        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={() => reset()}
            className="px-5 py-2.5 bg-[#1e2021] hover:bg-[#161819] text-white text-sm font-medium rounded-xl"
          >
            Try again
          </button>
          <a
            href="/"
            className="px-5 py-2.5 border border-gray-200 text-[#1e2021] text-sm font-medium rounded-xl hover:bg-white"
          >
            Home
          </a>
        </div>
      </body>
    </html>
  );
}
