import { auth } from "@clerk/nextjs/server";
import { clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/**
 * Creates a sign-in token for web → app session handoff.
 * Call after user signs in on web; returns a deep link that opens the app with the session.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const client = await clerkClient();
    const signInToken = await client.signInTokens.createSignInToken({
      userId,
      expiresInSeconds: 120,
    });

    const appUrl = `coconut://auth-handoff?__clerk_ticket=${encodeURIComponent(signInToken.token)}`;
    return NextResponse.json({ url: appUrl });
  } catch (err) {
    console.error("Return-to-app token error:", err);
    return NextResponse.json(
      { error: "Failed to create sign-in token" },
      { status: 500 }
    );
  }
}
