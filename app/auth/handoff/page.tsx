"use client";

import { useEffect, useState } from "react";
import { useSignIn } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";

export default function AuthHandoffPage() {
  const searchParams = useSearchParams();
  const { signIn, setActive, isLoaded } = useSignIn();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");

  useEffect(() => {
    const ticket = searchParams.get("__clerk_ticket");
    const redirectUrl = searchParams.get("redirect_url") || "/connect?from_app=1&via_login=1";

    if (!ticket || !isLoaded || !signIn) {
      setStatus("error");
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const result = await signIn.create({ ticket });
        const sessionId = result?.createdSessionId;
        if (cancelled) return;
        if (sessionId && setActive) {
          await setActive({ session: sessionId });
          setStatus("success");
          window.location.href = redirectUrl.startsWith("/") ? redirectUrl : "/connect?from_app=1&via_login=1";
        } else {
          setStatus("error");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [searchParams, signIn, setActive, isLoaded]);

  return (
    <div className="min-h-screen bg-[#F7FAF8] flex flex-col items-center justify-center p-6">
      {status === "loading" && (
        <p className="text-gray-600">Signing you in...</p>
      )}
      {status === "error" && (
        <div className="text-center">
          <p className="text-gray-600 mb-4">Could not sign in automatically.</p>
          <a
            href={`/login?redirect_url=${encodeURIComponent(searchParams.get("redirect_url") || "/connect?from_app=1&via_login=1")}`}
            className="text-[#3D8E62] font-medium underline"
          >
            Sign in manually
          </a>
        </div>
      )}
      {status === "success" && (
        <p className="text-gray-600">Redirecting...</p>
      )}
    </div>
  );
}
