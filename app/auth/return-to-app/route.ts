import { auth } from "@clerk/nextjs/server";
import { clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/**
 * Redirects to the app with a sign-in token. No intermediate page —
 * user taps "Open in app" → immediate redirect to coconut://auth-handoff.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.redirect("/login?redirect_url=/auth/return-to-app");
  }

  try {
    const client = await clerkClient();
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
