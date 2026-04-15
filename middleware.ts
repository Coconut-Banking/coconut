import { NextResponse } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher([
  "/",
  "/login(.*)",
  "/connect(.*)",
  "/auth(.*)",
  "/_clerk(.*)",
  "/api/stripe/webhook",
  "/api/stripe/connect/onboarding-return",
  "/api/stripe/connect/onboarding-refresh",
  "/api/plaid/webhook",
  "/api/webhooks(.*)",
  "/api/gmail/callback",
  "/api/demo",
  "/api/telegram-webhook",
  // Splitwise redirects here from their site — Safari has no Clerk cookie; user id comes from signed OAuth state.
  "/api/splitwise/callback",
  // Mobile app handoff — returns HTML that meta-refreshes to the custom scheme deep link.
  "/api/connect/app-done",
  "/join(.*)",
  "/api/invite(.*)",
  // Shadow write diagnostic endpoints — admin auth handled in route
  "/api/splitwise/shadow-diagnose",
  "/api/splitwise/shadow-test",
  "/api/splitwise/shadow-reset",
  "/api/splitwise/shadow-crud-test",
  // Mirror debug endpoints — admin auth handled in route (ENABLE_DEBUG_ENDPOINTS=true required)
  "/api/debug/splitwise-mirror(.*)",
]);

function isClerkRateLimitError(e: unknown): e is { status: number; retryAfter?: number } {
  if (!e || typeof e !== "object") return false;
  const err = e as Record<string, unknown>;
  return (
    err.clerkError === true &&
    (err.status === 429 || err.code === "api_response_error")
  );
}

const clerkHandler = clerkMiddleware(async (auth, req) => {
  const path = req.nextUrl.pathname;

  if (process.env.NODE_ENV === "production" && path === "/app/test-gmail") {
    return NextResponse.redirect(new URL("/app/dashboard", req.url), 302);
  }

  if (path === "/connect-from-app") {
    const redirectBack = "/connect?from_app=1&via_login=1";
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("redirect_url", redirectBack);
    const hint = req.nextUrl.searchParams.get("hint");
    if (hint) loginUrl.searchParams.set("hint", hint);
    return NextResponse.redirect(loginUrl, 307);
  }

  const fromApp = req.nextUrl.searchParams.get("from_app") === "1";
  const viaLogin = req.nextUrl.searchParams.get("via_login") === "1";
  if (path === "/connect" && fromApp && !viaLogin) {
    const scheme = req.nextUrl.searchParams.get("scheme");
    let redirectBack = "/connect?from_app=1&via_login=1";
    if (scheme) redirectBack += `&scheme=${encodeURIComponent(scheme)}`;
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("redirect_url", redirectBack);
    return NextResponse.redirect(loginUrl, 307);
  }

  if (isPublicRoute(req)) return;

  if (process.env.CLERK_DISABLED === "true" && process.env.NODE_ENV !== "production") {
    return NextResponse.next();
  }

  try {
    const { userId } = await auth();
    if (!userId) {
      if (req.nextUrl.pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      await auth.protect();
    }
  } catch (e) {
    if (isClerkRateLimitError(e)) {
      const retryAfter = (e as { retryAfter?: number }).retryAfter ?? 5;
      console.warn(`[middleware] Clerk 429 — returning rate limit response (retry ${retryAfter}s)`);
      return NextResponse.json(
        { error: "Too many requests — please try again shortly" },
        { status: 429, headers: { "Retry-After": String(retryAfter) } }
      );
    }
    throw e;
  }
});

export default async function middleware(req: Parameters<typeof clerkHandler>[0], evt: Parameters<typeof clerkHandler>[1]) {
  try {
    return await clerkHandler(req, evt);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[middleware] unhandled:", msg);
    if (msg.includes("jwk-kid-mismatch") || msg.includes("token verification failed")) {
      const url = new URL("/login", req.url);
      const res = NextResponse.redirect(url, 307);
      res.cookies.delete("__session");
      res.cookies.delete("__client_uat");
      res.cookies.delete("__clerk_db_jwt");
      return res;
    }
    if (req.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Auth error" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", req.url), 307);
  }
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
