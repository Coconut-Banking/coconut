export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { exchangeCode, saveGmailTokens, getOAuth2Client } from "@/lib/google-auth";
import { verifyOAuthState } from "@/lib/paypal-auth";
import { google } from "googleapis";

const ALLOWED_DEEP_LINKS = ["coconut://connected", "coconut://settings"];

function isAllowedRedirect(url: string): boolean {
  if (url.startsWith("/") && !url.startsWith("//") && !url.includes("://")) return true;
  return ALLOWED_DEEP_LINKS.some(
    (prefix) => url === prefix || url.startsWith(`${prefix}?`),
  );
}

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === 'development') console.log("[Gmail Callback] Starting OAuth callback processing");

  const code = request.nextUrl.searchParams.get("code");
  const rawState = request.nextUrl.searchParams.get("state");

  if (process.env.NODE_ENV === 'development') console.log("[Gmail Callback] Received:", {
    hasCode: !!code,
    hasState: !!rawState,
    stateLength: rawState?.length,
    codeLength: code?.length
  });

  if (!code || !rawState) {
    if (process.env.NODE_ENV === 'development') console.error("[Gmail Callback] Missing code or state");
    return NextResponse.redirect(new URL("/app/email-receipts?error=missing_params", request.url));
  }

  // Split off the optional mobile redirect suffix (appended after a pipe separator in getAuthUrl).
  const pipeIdx = rawState.indexOf("|");
  const signedPart = pipeIdx === -1 ? rawState : rawState.slice(0, pipeIdx);
  const encodedRedirect = pipeIdx === -1 ? undefined : rawState.slice(pipeIdx + 1);

  // Verify HMAC-signed state (BUG-AUTH-1 fix). Reject tampered or expired states.
  const stateResult = verifyOAuthState(signedPart);
  if (!stateResult.valid) {
    if (process.env.NODE_ENV === 'development') console.error("[Gmail Callback] Invalid or expired OAuth state");
    return NextResponse.redirect(new URL("/app/email-receipts?error=invalid_state", request.url));
  }
  const clerkUserId = stateResult.userId;

  // Decode the mobile redirect URL if present.
  let mobileRedirect: string | undefined;
  if (encodedRedirect) {
    try {
      mobileRedirect = Buffer.from(encodedRedirect, "base64url").toString("utf8");
    } catch {
      mobileRedirect = undefined;
    }
  }

  // Session check (BUG-AUTH-2 fix):
  // - Web: an active Clerk session must belong to the same user.
  // - Mobile (Safari redirect): no Clerk session cookie is present; the HMAC-signed state is
  //   sufficient proof of identity, so we allow requests where authedUserId is null.
  const { userId: authedUserId } = await auth();
  if (authedUserId && authedUserId !== clerkUserId) {
    if (process.env.NODE_ENV === 'development') console.error("[Gmail Callback] Auth mismatch: session userId does not match state userId", {
      stateUserId: clerkUserId,
      authedUserId,
    });
    return NextResponse.redirect(new URL("/app/email-receipts?error=unauthorized", request.url));
  }

  const sanitizedRedirect = mobileRedirect && isAllowedRedirect(mobileRedirect)
    ? mobileRedirect
    : undefined;

  try {
    if (process.env.NODE_ENV === 'development') console.log("[Gmail Callback] Exchanging code for tokens...");
    const tokens = await exchangeCode(code);
    if (process.env.NODE_ENV === 'development') console.log("[Gmail Callback] Token exchange successful:", {
      hasAccessToken: !!tokens.access_token,
      hasRefreshToken: !!tokens.refresh_token,
      expiryDate: tokens.expiry_date
    });

    let email: string | undefined;
    try {
      if (process.env.NODE_ENV === 'development') console.log("[Gmail Callback] Fetching user email...");
      const client = getOAuth2Client();
      client.setCredentials(tokens);
      const gmail = google.gmail({ version: "v1", auth: client });
      const profile = await gmail.users.getProfile({ userId: "me" });
      email = profile.data.emailAddress ?? undefined;
      if (process.env.NODE_ENV === 'development') console.log("[Gmail Callback] Got email:", email);
    } catch (e) {
      if (process.env.NODE_ENV === 'development') console.warn("[Gmail Callback] Failed to get email (non-critical):", e);
    }

    if (process.env.NODE_ENV === 'development') console.log("[Gmail Callback] Saving tokens to database...");
    await saveGmailTokens(clerkUserId, tokens, email);
    if (process.env.NODE_ENV === 'development') console.log("[Gmail Callback] Tokens saved successfully");

    // Fire-and-forget: scan last 90 days of receipts on first connect
    import("@/lib/receipt-parser")
      .then(({ scanGmailForReceipts }) => scanGmailForReceipts(clerkUserId, 90, true, false))
      .then((result) => { if (process.env.NODE_ENV === 'development') console.log("[Gmail Callback] Initial scan complete:", result); })
      .catch((err) => { if (process.env.NODE_ENV === 'development') console.warn("[Gmail Callback] Initial scan failed (non-blocking):", err); });

    if (sanitizedRedirect) {
      const url = sanitizedRedirect.startsWith("/")
        ? new URL(`${sanitizedRedirect}?connected=true`, request.url)
        : `${sanitizedRedirect}?connected=true`;
      if (process.env.NODE_ENV === 'development') console.log("[Gmail Callback] Redirecting:", url);
      return NextResponse.redirect(url);
    }

    return NextResponse.redirect(new URL("/app/email-receipts?connected=true", request.url));
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.error("[Gmail Callback] Token exchange failed:", e);

    if (sanitizedRedirect) {
      const url = sanitizedRedirect.startsWith("/")
        ? new URL(`${sanitizedRedirect}?error=auth_failed`, request.url)
        : `${sanitizedRedirect}?error=auth_failed`;
      return NextResponse.redirect(url);
    }

    return NextResponse.redirect(new URL("/app/email-receipts?error=auth_failed", request.url));
  }
}
