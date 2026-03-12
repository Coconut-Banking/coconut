import { NextResponse } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher([
  "/",
  "/login(.*)",
  "/connect(.*)",
  "/api/stripe/webhook",
  "/api/gmail/callback",
  "/api/demo",
]);

export default clerkMiddleware(async (auth, req) => {
  // When opening /connect from app: force through login first (same flow on simulator + phone)
  const path = req.nextUrl.pathname;
  const fromApp = req.nextUrl.searchParams.get("from_app") === "1";
  const viaLogin = req.nextUrl.searchParams.get("via_login") === "1";
  if (path === "/connect" && fromApp && !viaLogin) {
    const redirectBack = "/connect?from_app=1&via_login=1";
    return NextResponse.redirect(
      new URL(`/login?redirect_url=${encodeURIComponent(redirectBack)}`, req.url)
    );
  }

  if (isPublicRoute(req)) return;

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
