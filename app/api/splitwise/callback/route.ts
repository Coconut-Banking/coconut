export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { exchangeCode } from "@/lib/splitwise";
import { getSupabase } from "@/lib/supabase";
import { encryptToken } from "@/lib/encryption";
import { verifyOAuthState } from "@/lib/paypal-auth";

const ALLOWED_APP_SCHEMES = new Set(["coconut", "coconut-dev"]);

function appSchemeFromVerification(v: { appSchemeKey?: "p" | "d" }): string {
  if (v.appSchemeKey === "d") return "coconut-dev";
  if (v.appSchemeKey === "p") return "coconut";
  const fromEnv = process.env.MOBILE_APP_SCHEME?.trim().toLowerCase().replace(/[^a-z0-9._+-]/g, "") ?? "";
  if (fromEnv && ALLOWED_APP_SCHEMES.has(fromEnv)) return fromEnv;
  return "coconut";
}

/** Same host-style shape as Clerk SSO (`scheme://sso-callback`). */
function buildSplitwiseAppDeepLink(schemeRaw: string, query: Record<string, string>): string {
  const scheme = ALLOWED_APP_SCHEMES.has(schemeRaw.trim().toLowerCase())
    ? schemeRaw.trim().toLowerCase()
    : "coconut";
  const u = new URL(`${scheme}://splitwise-callback`);
  for (const [k, val] of Object.entries(query)) {
    u.searchParams.set(k, val);
  }
  return u.toString();
}

function escapeHtmlAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;");
}

/**
 * Instant redirect to the app's custom-scheme deep link.
 * ASWebAuthenticationSession watches for the custom scheme (e.g. "coconut-dev://")
 * and dismisses the browser the moment the redirect fires — the user never sees
 * this page. The HTML body is only a fallback for external Safari.
 */
function splitwiseMobileReturnPage(deepLink: string, bodyText: string): NextResponse {
  console.info("[splitwise/callback] app handoff", { schemePreview: deepLink.split(":")[0] });
  const href = escapeHtmlAttr(deepLink);
  const jsUrl = JSON.stringify(deepLink);
  const html = [
    "<!DOCTYPE html>",
    '<html lang="en"><head><meta charset="utf-8"/>',
    '<meta name="viewport" content="width=device-width,initial-scale=1"/>',
    `<meta http-equiv="refresh" content="0;url=${href}"/>`,
    "<title>Coconut</title>",
    `<script>window.location.replace(${jsUrl});</script>`,
    "</head>",
    '<body style="font-family:system-ui,-apple-system,sans-serif;padding:28px 20px;text-align:center;background:#f8fafc;color:#111">',
    `<p style="font-size:17px;line-height:1.45;margin:0 0 12px">${bodyText}</p>`,
    `<p style="margin:20px 0 0"><a id="open" href="${href}" style="display:inline-block;padding:14px 22px;background:#3D8E62;color:#fff;border-radius:12px;text-decoration:none;font-weight:600">Open Coconut</a></p>`,
    '<p style="font-size:14px;color:#64748b;margin-top:24px">If the app didn&#39;t open, tap the button above.</p>',
    "</body></html>",
  ].join("\n");
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
      ? "Splitwise couldn&#39;t finish connecting. Return to the app to try again."
      : "You&#39;re signed in to Splitwise. Return to Coconut to import your groups."
  );
}

export async function GET(req: NextRequest) {
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
    console.warn("[splitwise/callback] invalid OAuth state", {
      returnToApp: Boolean(verified.returnToApp),
      stateLength: state.length,
      hasCode: Boolean(code),
    });
    if (verified.returnToApp) {
      return appSettingsDeepLink(req, { splitwise_error: "invalid_state" });
    }
    return NextResponse.redirect(
      new URL("/app/settings?splitwise_error=invalid_state", req.url)
    );
  }

  if (!verified.returnToApp) {
    // Web flow: Clerk session must be present and match the userId in the signed state.
    // Only call getUserId() here — mobile flows have no Clerk session on this domain
    // and CLERK_DISABLED=true would return a bypass ID that would cause a false mismatch.
    const sessionUserId = await getUserId();
    if (!sessionUserId || sessionUserId !== verified.userId) {
      return NextResponse.redirect(
        new URL("/app/settings?splitwise_error=invalid_state", req.url)
      );
    }
  }
  // Mobile app flow (returnToApp=true): Mobile Safari has no Clerk session on this domain;
  // rely on HMAC-signed state exclusively. Do not call getUserId() here.

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
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("invalid_grant")) {
      const db = getSupabase();
      const { data: existing } = await db
        .from("splitwise_tokens")
        .select("id")
        .eq("clerk_user_id", clerkUserId)
        .maybeSingle();
      if (existing) {
        console.info("[splitwise/callback] invalid_grant but token present (likely duplicate request); ok handoff");
        if (verified.returnToApp) {
          return appSettingsDeepLink(req, { splitwise: "connected", import: "1" });
        }
        return NextResponse.redirect(new URL("/app/settings?splitwise=connected", req.url));
      }
    }
    console.error("[splitwise] OAuth callback error:", err);
    if (verified.returnToApp) {
      return appSettingsDeepLink(req, { splitwise_error: "token_exchange_failed" });
    }
    return NextResponse.redirect(
      new URL("/app/settings?splitwise_error=token_exchange_failed", req.url)
    );
  }
}
