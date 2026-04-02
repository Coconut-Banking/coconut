/**
 * Fallback only — middleware redirects /connect-from-app → /login.
 * Renders only if redirect fails.
 */
export default function ConnectFromAppPage() {
  return (
    <div className="min-h-screen bg-[#F5F3F2] flex flex-col items-center justify-center p-6">
      <p className="text-gray-600 text-center text-sm">
        Redirect failed. <a href="/login?redirect_url=%2Fconnect%3Ffrom_app%3D1%26via_login%3D1" className="text-[#1e2021] font-medium underline">Sign in</a>
      </p>
    </div>
  );
}
