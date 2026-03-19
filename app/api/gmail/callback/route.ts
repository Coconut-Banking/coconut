import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { exchangeCode, saveGmailTokens, getOAuth2Client } from "@/lib/google-auth";
import { google } from "googleapis";

function parseOAuthState(raw: string): { userId: string; redirect?: string } {
  try {
    const parsed = JSON.parse(raw);
    if (parsed.userId) return parsed;
  } catch {
    // Legacy format: state is just the clerkUserId string
  }
  return { userId: raw };
}

const ALLOWED_DEEP_LINKS = ["coconut://connected", "coconut://settings"];

function isAllowedRedirect(url: string): boolean {
  if (url.startsWith("/") && !url.startsWith("//") && !url.includes("://")) return true;
  return ALLOWED_DEEP_LINKS.some(
    (prefix) => url === prefix || url.startsWith(`${prefix}?`),
  );
}

export async function GET(request: NextRequest) {
  console.log("[Gmail Callback] Starting OAuth callback processing");

  const code = request.nextUrl.searchParams.get("code");
  const rawState = request.nextUrl.searchParams.get("state");

  console.log("[Gmail Callback] Received:", {
    hasCode: !!code,
    hasState: !!rawState,
    stateLength: rawState?.length,
    codeLength: code?.length
  });

  if (!code || !rawState) {
    console.error("[Gmail Callback] Missing code or state");
    return NextResponse.redirect(new URL("/app/email-receipts?error=missing_params", request.url));
  }

  const { userId: clerkUserId, redirect: mobileRedirect } = parseOAuthState(rawState);

  const { userId: authedUserId } = await auth();
  if (!authedUserId || authedUserId !== clerkUserId) {
    console.error("[Gmail Callback] Auth mismatch: state userId does not match authenticated user", {
      stateUserId: clerkUserId,
      authedUserId,
    });
    return NextResponse.redirect(new URL("/app/email-receipts?error=unauthorized", request.url));
  }

  const sanitizedRedirect = mobileRedirect && isAllowedRedirect(mobileRedirect)
    ? mobileRedirect
    : undefined;

  try {
    console.log("[Gmail Callback] Exchanging code for tokens...");
    const tokens = await exchangeCode(code);
    console.log("[Gmail Callback] Token exchange successful:", {
      hasAccessToken: !!tokens.access_token,
      hasRefreshToken: !!tokens.refresh_token,
      expiryDate: tokens.expiry_date
    });

    let email: string | undefined;
    try {
      console.log("[Gmail Callback] Fetching user email...");
      const client = getOAuth2Client();
      client.setCredentials(tokens);
      const gmail = google.gmail({ version: "v1", auth: client });
      const profile = await gmail.users.getProfile({ userId: "me" });
      email = profile.data.emailAddress ?? undefined;
      console.log("[Gmail Callback] Got email:", email);
    } catch (e) {
      console.warn("[Gmail Callback] Failed to get email (non-critical):", e);
    }

    console.log("[Gmail Callback] Saving tokens to database...");
    await saveGmailTokens(clerkUserId, tokens, email);
    console.log("[Gmail Callback] Tokens saved successfully");

    if (sanitizedRedirect) {
      const url = sanitizedRedirect.startsWith("/")
        ? new URL(`${sanitizedRedirect}?connected=true`, request.url)
        : `${sanitizedRedirect}?connected=true`;
      console.log("[Gmail Callback] Redirecting:", url);
      return NextResponse.redirect(url);
    }

    return NextResponse.redirect(new URL("/app/email-receipts?connected=true", request.url));
  } catch (e) {
    console.error("[Gmail Callback] Token exchange failed:", e);

    if (sanitizedRedirect) {
      const url = sanitizedRedirect.startsWith("/")
        ? new URL(`${sanitizedRedirect}?error=auth_failed`, request.url)
        : `${sanitizedRedirect}?error=auth_failed`;
      return NextResponse.redirect(url);
    }

    return NextResponse.redirect(new URL("/app/email-receipts?error=auth_failed", request.url));
  }
}
