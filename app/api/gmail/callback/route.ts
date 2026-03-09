import { NextRequest, NextResponse } from "next/server";
import { exchangeCode, saveGmailTokens, getOAuth2Client } from "@/lib/google-auth";
import { google } from "googleapis";

export async function GET(request: NextRequest) {
  console.log("[Gmail Callback] Starting OAuth callback processing");

  const code = request.nextUrl.searchParams.get("code");
  const clerkUserId = request.nextUrl.searchParams.get("state");

  console.log("[Gmail Callback] Received:", {
    hasCode: !!code,
    clerkUserId,
    codeLength: code?.length
  });

  if (!code || !clerkUserId) {
    console.error("[Gmail Callback] Missing code or state");
    return NextResponse.redirect(new URL("/app/email-receipts?error=missing_params", request.url));
  }

  try {
    console.log("[Gmail Callback] Exchanging code for tokens...");
    const tokens = await exchangeCode(code);
    console.log("[Gmail Callback] Token exchange successful:", {
      hasAccessToken: !!tokens.access_token,
      hasRefreshToken: !!tokens.refresh_token,
      expiryDate: tokens.expiry_date
    });

    // Get the user's email from Gmail profile
    let email: string | undefined;
    try {
      console.log("[Gmail Callback] Fetching user email...");
      const client = getOAuth2Client();
      client.setCredentials(tokens);
      const gmail = google.gmail({ version: "v1", auth: client });
      const profile = await gmail.users.getProfile({ userId: "me" });
      email = profile.data.emailAddress || undefined;
      console.log("[Gmail Callback] Got email:", email);
    } catch (e) {
      console.warn("[Gmail Callback] Failed to get email (non-critical):", e);
    }

    console.log("[Gmail Callback] Saving tokens to database...");
    await saveGmailTokens(clerkUserId, tokens, email);
    console.log("[Gmail Callback] Tokens saved successfully");

    // Redirect to email-receipts page with success message
    return NextResponse.redirect(new URL("/app/email-receipts?connected=true", request.url));
  } catch (e) {
    console.error("[Gmail Callback] Token exchange failed:", e);
    return NextResponse.redirect(new URL("/app/email-receipts?error=auth_failed", request.url));
  }
}
