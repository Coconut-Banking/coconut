"use client";

import { useEffect, useState } from "react";

/**
 * After signing in on web, fetches a sign-in token and shows an "Open in App" button.
 * Mobile browsers block programmatic redirects to custom schemes (coconut://) unless
 * triggered by a direct user tap — so we show a button the user taps to open the app.
 */
export default function ReturnToAppPage() {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [appUrl, setAppUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/auth/return-to-app-token", {
          credentials: "include",
        });
        if (cancelled) return;
        if (!res.ok) {
          setStatus("error");
          return;
        }
        const { url } = await res.json();
        if (!url || cancelled) return;
        setAppUrl(url);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#F7FAF8] flex flex-col items-center justify-center p-6">
      {status === "loading" && (
        <p className="text-gray-600">Preparing to open the app...</p>
      )}
      {status === "ready" && appUrl && (
        <div className="text-center max-w-sm">
          <p className="text-gray-600 mb-6">
            You&apos;re signed in! Tap below to open the Coconut app.
          </p>
          <a
            href={appUrl}
            className="block w-full bg-[#3D8E62] hover:bg-[#2D7A52] text-white font-medium rounded-xl px-6 py-4 text-center"
          >
            Open Coconut App
          </a>
          <a
            href="/app/dashboard"
            className="mt-4 block text-[#3D8E62] font-medium underline text-sm"
          >
            Continue in browser instead
          </a>
        </div>
      )}
      {status === "error" && (
        <div className="text-center">
          <p className="text-gray-600 mb-4">Could not return to app.</p>
          <a
            href="/app/dashboard"
            className="text-[#3D8E62] font-medium underline"
          >
            Continue in browser
          </a>
        </div>
      )}
    </div>
  );
}
