import { auth } from "@clerk/nextjs/server";
import { clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/**
 * Creates a short-lived sign-in token for app-to-web session handoff.
 * App calls with Bearer token; we create a Clerk sign-in token and return the URL.
 * The app opens that URL so the user is signed in on web without re-entering credentials.
 */
export async function POST() {
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

    const base = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "https://coconut-lemon.vercel.app";
    const redirect = encodeURIComponent(`${base}/connect?from_app=1&via_login=1`);
    const url = `${base}/auth/handoff?__clerk_ticket=${encodeURIComponent(signInToken.token)}&redirect_url=${redirect}`;

    return NextResponse.json({ url });
  } catch (err) {
    console.error("Handoff token error:", err);
    return NextResponse.json(
      { error: "Failed to create handoff token" },
      { status: 500 }
    );
  }
}
