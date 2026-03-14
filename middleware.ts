import { NextResponse } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher([
  "/",
  "/login(.*)",
  "/connect(.*)",
  "/auth(.*)",
  "/api/stripe/webhook",
  "/api/plaid/webhook",
  "/api/webhooks(.*)",
  "/api/gmail/callback",
  "/api/demo",
]);

export default clerkMiddleware(async (auth, req) => {
  const path = req.nextUrl.pathname;

  // Dev-only pages: redirect to dashboard in production
  if (process.env.NODE_ENV === "production" && path === "/app/test-gmail") {
    return NextResponse.redirect(new URL("/app/dashboard", req.url), 302);
  }

  // Dedicated app entry: /connect-from-app always redirects to login (no caching, no race)
  if (path === "/connect-from-app") {
    const redirectBack = "/connect?from_app=1&via_login=1";
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("redirect_url", redirectBack);
    const hint = req.nextUrl.searchParams.get("hint");
    if (hint) loginUrl.searchParams.set("hint", hint);
    return NextResponse.redirect(loginUrl, 307);
  }

  // When /connect?from_app=1 without via_login: force through login first
  const fromApp = req.nextUrl.searchParams.get("from_app") === "1";
  const viaLogin = req.nextUrl.searchParams.get("via_login") === "1";
  if (path === "/connect" && fromApp && !viaLogin) {
    const redirectBack = "/connect?from_app=1&via_login=1";
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("redirect_url", redirectBack);
    return NextResponse.redirect(loginUrl, 307);
  }

  if (isPublicRoute(req)) return;

  // Bypass Clerk auth when CLERK_DISABLED=true (e.g. debugging user ID / Plaid issues)
  if (process.env.CLERK_DISABLED === "true") {
    return NextResponse.next();
  }

  const { isAuthenticated } = await auth();
  if (!isAuthenticated) {
    // API routes: return 401 so the app can show "Sign in with same account" (Clerk's protect() returns 404)
    if (req.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
