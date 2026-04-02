export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";

const ALLOWED_SCHEMES = new Set(["coconut", "coconut-dev"]);

/**
 * Redirects to the mobile app via HTTP 302 to the custom-scheme deep link.
 * ASWebAuthenticationSession (used by openAuthSessionAsync) reliably detects
 * server-level 302 redirects to custom schemes and auto-dismisses the browser.
 *
 * Falls back to an HTML page with meta-refresh + JS redirect for browsers
 * that don't follow 302s to custom schemes.
 */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("scheme") ?? "coconut";
  const scheme = ALLOWED_SCHEMES.has(raw.toLowerCase()) ? raw.toLowerCase() : "coconut";
  const deepLink = `${scheme}://connected`;

  return new NextResponse(null, {
    status: 302,
    headers: {
      Location: deepLink,
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
