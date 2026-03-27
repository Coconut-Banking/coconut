export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { exchangeCode } from "@/lib/splitwise";
import { getSupabase } from "@/lib/supabase";
import { encryptToken } from "@/lib/encryption";
import { verifyOAuthState } from "@/lib/paypal-auth";

function appSchemeFromVerification(v: { appSchemeKey?: "p" | "d" }): string {
  if (process.env.MOBILE_APP_SCHEME?.trim()) {
    return process.env.MOBILE_APP_SCHEME.trim();
  }
  return v.appSchemeKey === "d" ? "coconut-dev" : "coconut";
}

function appSettingsDeepLink(req: NextRequest, query: Record<string, string>): NextResponse {
  const state = req.nextUrl.searchParams.get("state") ?? "";
  const verified = verifyOAuthState(state);
  if (!verified.valid || !verified.returnToApp) {
    const u = new URL("/app/settings", req.url);
    for (const [k, val] of Object.entries(query)) {
      u.searchParams.set(k, val);
    }
    return NextResponse.redirect(u);
  }
  const scheme = appSchemeFromVerification(verified);
  const q = new URLSearchParams(query).toString();
  // Path must not contain "(" / ")" — iOS Safari rejects e.g. coconut-dev:///(tabs)/settings?...
  return NextResponse.redirect(`${scheme}://splitwise-callback${q ? `?${q}` : ""}`);
}

export async function GET(req: NextRequest) {
  const sessionUserId = await getUserId();
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state") ?? "";
  const verified = verifyOAuthState(state);

  if (!code) {
    const error = req.nextUrl.searchParams.get("error") ?? "missing_code";
    if (verified.valid && verified.returnToApp) {
      return appSettingsDeepLink(req, { splitwise_error: error });
    }
    return NextResponse.redirect(
      new URL(`/app/settings?splitwise_error=${encodeURIComponent(error)}`, req.url)
    );
  }

  if (!verified.valid) {
    if (verified.returnToApp) {
      return appSettingsDeepLink(req, { splitwise_error: "invalid_state" });
    }
    return NextResponse.redirect(
      new URL("/app/settings?splitwise_error=invalid_state", req.url)
    );
  }

  // Mobile Safari has no Clerk session on this domain; user id is bound in signed state from /auth.
  if (sessionUserId && sessionUserId !== verified.userId) {
    if (verified.returnToApp) {
      return appSettingsDeepLink(req, { splitwise_error: "invalid_state" });
    }
    return NextResponse.redirect(
      new URL("/app/settings?splitwise_error=invalid_state", req.url)
    );
  }

  const clerkUserId = verified.userId;

  try {
    const accessToken = await exchangeCode(code);

    const db = getSupabase();
    await db.from("splitwise_tokens").upsert(
      { clerk_user_id: clerkUserId, access_token: encryptToken(accessToken) },
      { onConflict: "clerk_user_id" }
    );

    if (verified.returnToApp) {
      return appSettingsDeepLink(req, { splitwise: "connected", import: "1" });
    }

    return NextResponse.redirect(new URL("/app/settings?splitwise=connected", req.url));
  } catch (err) {
    console.error("[splitwise] OAuth callback error:", err);
    if (verified.returnToApp) {
      return appSettingsDeepLink(req, { splitwise_error: "token_exchange_failed" });
    }
    return NextResponse.redirect(
      new URL("/app/settings?splitwise_error=token_exchange_failed", req.url)
    );
  }
}
