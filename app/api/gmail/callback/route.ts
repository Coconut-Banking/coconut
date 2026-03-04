import { NextRequest, NextResponse } from "next/server";
import { exchangeCode, saveGmailTokens, getOAuth2Client } from "@/lib/google-auth";
import { google } from "googleapis";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const clerkUserId = request.nextUrl.searchParams.get("state");

  if (!code || !clerkUserId) {
    return NextResponse.redirect(new URL("/app/settings?gmail=error", request.url));
  }

  try {
    const tokens = await exchangeCode(code);

    // Get the user's email from Gmail profile
    let email: string | undefined;
    try {
      const client = getOAuth2Client();
      client.setCredentials(tokens);
      const gmail = google.gmail({ version: "v1", auth: client });
      const profile = await gmail.users.getProfile({ userId: "me" });
      email = profile.data.emailAddress || undefined;
    } catch { /* non-critical */ }

    await saveGmailTokens(clerkUserId, tokens, email);

    return NextResponse.redirect(new URL("/app/settings?gmail=connected", request.url));
  } catch (e) {
    console.error("[gmail/callback] Token exchange failed:", e);
    return NextResponse.redirect(new URL("/app/settings?gmail=error", request.url));
  }
}
