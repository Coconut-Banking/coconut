export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { exchangeCode } from "@/lib/splitwise";
import { getSupabase } from "@/lib/supabase";
import { encryptToken } from "@/lib/encryption";
import { verifyOAuthState } from "@/lib/paypal-auth";

const ALLOWED_APP_SCHEMES = new Set(["coconut", "coconut-dev"]);

function appSchemeFromVerification(v: { appSchemeKey?: "p" | "d" }): string {
  // Prefer signed OAuth state from /api/splitwise/auth-url (matches the build that tapped Connect).
  // If MOBILE_APP_SCHEME overrides this, dev users on production API get coconut:// links while the
  // app only registers coconut-dev:// — Safari shows "invalid address" and the app never opens.
  if (v.appSchemeKey === "d") return "coconut-dev";
  if (v.appSchemeKey === "p") return "coconut";
  const fromEnv = process.env.MOBILE_APP_SCHEME?.trim().toLowerCase().replace(/[^a-z0-9._+-]/g, "") ?? "";
  if (fromEnv && ALLOWED_APP_SCHEMES.has(fromEnv)) return fromEnv;
  return "coconut";
}

/**
 * Path-style custom URI (empty host): coconut-dev:///splitwise-callback?…
 * Expo-router maps this to route `splitwise-callback`; avoids host-only forms some iOS versions reject from https pages.
 */
function buildSplitwiseAppDeepLink(schemeRaw: string, query: Record<string, string>): string {
  const scheme = ALLOWED_APP_SCHEMES.has(schemeRaw.trim().toLowerCase())
    ? schemeRaw.trim().toLowerCase()
    : "coconut";
  const u = new URL(`${scheme}:///splitwise-callback`);
  for (const [k, val] of Object.entries(query)) {
    u.searchParams.set(k, val);
  }
  return u.toString();
}

function escapeHtmlAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;");
}

/**
 * Safari often mishandles 302 → custom scheme after OAuth. A short HTML page with a real link + JS handoff
 * is more reliable than Location alone.
 */
function splitwiseMobileReturnPage(deepLink: string, bodyText: string): NextResponse {
  // 200 + HTML (not 307 → custom scheme): Safari often rejects Location redirects to coconut://
  console.info("[splitwise/callback] app handoff: 200 HTML page + link", {
    schemePreview: deepLink.split(":")[0],
  });
  const href = escapeHtmlAttr(deepLink);
  const jsTarget = JSON.stringify(deepLink);
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Coconut</title></head>
<body style="font-family:system-ui,-apple-system,sans-serif;padding:28px 20px;text-align:center;background:#f8fafc;color:#111">
<p style="font-size:17px;line-height:1.45;margin:0 0 12px">${bodyText}</p>
<p style="margin:20px 0 0"><a href="${href}" style="display:inline-block;padding:14px 22px;background:#3D8E62;color:#fff;border-radius:12px;text-decoration:none;font-weight:600">Open Coconut</a></p>
<p style="font-size:14px;color:#64748b;margin-top:24px">If nothing happens, tap the button above.</p>
<script>try{setTimeout(function(){location.replace(${jsTarget});},80);}catch(e){}</script>
</body></html>`;
  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
    },
  });
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
  const deepLink = buildSplitwiseAppDeepLink(scheme, query);
  const isError = query.splitwise_error != null && query.splitwise_error !== "";
  return splitwiseMobileReturnPage(
    deepLink,
    isError
      ? "Splitwise couldn&rsquo;t finish connecting. Return to the app to try again."
      : "You&rsquo;re signed in to Splitwise. Return to Coconut to import your groups."
  );
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
    // Web flow: redirect within the site (Vercel will log 307 — that is normal, not an error).
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

  if (!verified.returnToApp) {
    // Web flow: Clerk session must be present and match the userId in the signed state.
    if (!sessionUserId || sessionUserId !== verified.userId) {
      return NextResponse.redirect(
        new URL("/app/settings?splitwise_error=invalid_state", req.url)
      );
    }
  } else {
    // Mobile app flow (returnToApp=true): Mobile Safari has no Clerk session on this domain;
    // rely on HMAC-signed state exclusively.
    if (sessionUserId && sessionUserId !== verified.userId) {
      return appSettingsDeepLink(req, { splitwise_error: "invalid_state" });
    }
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
