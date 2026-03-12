"use client";

/**
 * Fallback page - should never render because middleware redirects /connect-from-app to /login.
 * If you see this page, the middleware redirect is not firing.
 */
export default function ConnectFromAppPage() {
  return (
    <div className="min-h-screen bg-[#F7FAF8] flex flex-col items-center justify-center p-6">
      <p className="text-gray-600 text-center">
        You should have been redirected to sign in. If you see this, the middleware redirect failed.
      </p>
      <a
        href="/login?redirect_url=%2Fconnect%3Ffrom_app%3D1%26via_login%3D1"
        className="mt-4 text-[#3D8E62] font-medium underline"
      >
        Sign in manually
      </a>
    </div>
  );
}
