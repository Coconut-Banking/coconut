import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/stripe/connect/onboarding-refresh
 * Stripe redirects here when the Account Link expires or the user needs to restart.
 * We redirect back to the mobile app so it can request a fresh onboarding link.
 */
export async function GET(req: NextRequest) {
  const accountId = req.nextUrl.searchParams.get("account_id") ?? "";
  const scheme = req.nextUrl.searchParams.get("scheme") ?? "coconut";

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Redirecting…</title></head>
<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
<p>Redirecting back to Coconut…</p>
<script>
  window.location.href = ${JSON.stringify(scheme)} + "://stripe-connect-return?status=refresh&account_id=${accountId}";
  setTimeout(function() { window.close(); }, 2000);
</script>
</body></html>`;

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html" },
  });
}
