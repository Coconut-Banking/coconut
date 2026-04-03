"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2 } from "lucide-react";

const DEFAULT_SCHEME = "coconut";

function safeScheme(raw: string | null): string {
  if (!raw) return DEFAULT_SCHEME;
  if (/^[a-z][a-z0-9-]{0,63}$/i.test(raw)) return raw.toLowerCase();
  return DEFAULT_SCHEME;
}

function PlaidOauthContent() {
  const searchParams = useSearchParams();
  const scheme = safeScheme(searchParams.get("scheme"));
  const deepLink = `${scheme}://connected`;

  return (
    <div className="min-h-screen bg-[#F5F3F2] flex items-center justify-center p-6">
      <div className="text-center max-w-md">
        <CheckCircle2
          size={40}
          className="text-[#1e2021] mx-auto mb-4"
          aria-hidden
        />
        <p className="text-base text-gray-900 mb-8">
          Bank connected — you can return to the Coconut app.
        </p>
        <a
          href={deepLink}
          className="inline-flex items-center justify-center bg-[#1e2021] hover:bg-[#161819] text-white py-2.5 px-6 rounded-xl text-sm font-medium transition-colors"
        >
          Return to app
        </a>
      </div>
    </div>
  );
}

function Fallback() {
  return (
    <div className="min-h-screen bg-[#F5F3F2] flex items-center justify-center p-6">
      <p className="text-sm text-gray-600">Loading…</p>
    </div>
  );
}

export default function PlaidOauthPage() {
  return (
    <Suspense fallback={<Fallback />}>
      <PlaidOauthContent />
    </Suspense>
  );
}
