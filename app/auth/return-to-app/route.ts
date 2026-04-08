import { auth } from "@clerk/nextjs/server";
import { clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/**
 * Redirects to the app with a sign-in token. No intermediate page —
 * user taps "Open in app" → immediate redirect to coconut://auth-handoff.
 */
export async function GET() {
  // Parallelize auth + clerkClient initialization (independent)
  const [{ userId }, client] = await Promise.all([auth(), clerkClient()]);
  if (!userId) {
    return NextResponse.redirect("/login?redirect_url=/auth/return-to-app");
  }

  try {
    const signInToken = await client.signInTokens.createSignInToken({
      userId,
      expiresInSeconds: 120,
    });

    const appUrl = `coconut://auth-handoff?__clerk_ticket=${encodeURIComponent(signInToken.token)}`;
    return NextResponse.redirect(appUrl);
  } catch (err) {
    console.error("Return-to-app token error:", err);
    return NextResponse.redirect("/app/dashboard");
  }
}
