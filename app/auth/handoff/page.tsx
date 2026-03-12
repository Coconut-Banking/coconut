"use client";

import { useEffect, useState } from "react";
import { useSignIn } from "@clerk/nextjs";

export default function AuthHandoffPage() {
  const { signIn, setActive, isLoaded } = useSignIn();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [redirectUrl, setRedirectUrl] = useState("/connect?from_app=1&via_login=1");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ticket = params.get("__clerk_ticket");
    const redirect = params.get("redirect_url") || "/connect?from_app=1&via_login=1";
    setRedirectUrl(redirect);

    if (!ticket || !isLoaded || !signIn) {
      setStatus("error");
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const result = await signIn.create({ strategy: "ticket", ticket });
        const sessionId = result?.createdSessionId;
        if (cancelled) return;
        if (sessionId && setActive) {
          await setActive({ session: sessionId });
          setStatus("success");
          window.location.href = redirect.startsWith("/") ? redirect : "/connect?from_app=1&via_login=1";
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
  }, [signIn, setActive, isLoaded]);

  return (
    <div className="min-h-screen bg-[#F7FAF8] flex flex-col items-center justify-center p-6">
      {status === "loading" && (
        <p className="text-gray-600">Signing you in…</p>
      )}
      {status === "error" && (
        <div className="text-center">
          <p className="text-gray-600 mb-4">Could not sign in automatically.</p>
          <a
            href={`/login?redirect_url=${encodeURIComponent(redirectUrl)}`}
            className="text-[#3D8E62] font-medium underline"
          >
            Sign in manually
          </a>
        </div>
      )}
      {status === "success" && (
        <p className="text-gray-600">Redirecting…</p>
      )}
    </div>
  );
}
