export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { exchangeCode } from "@/lib/splitwise";
import { getSupabase } from "@/lib/supabase";
import { encryptToken } from "@/lib/encryption";
import { verifyOAuthState } from "@/lib/paypal-auth";

export async function GET(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return NextResponse.redirect(new URL("/login", req.url));

  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    const error = req.nextUrl.searchParams.get("error") ?? "missing_code";
    return NextResponse.redirect(
      new URL(`/app/settings?splitwise_error=${encodeURIComponent(error)}`, req.url)
    );
  }

  // Validate OAuth state to prevent CSRF
  const state = req.nextUrl.searchParams.get("state") ?? "";
  const { userId: stateUserId, valid } = verifyOAuthState(state);
  if (!valid || stateUserId !== userId) {
    return NextResponse.redirect(
      new URL("/app/settings?splitwise_error=invalid_state", req.url)
    );
  }

  try {
    const accessToken = await exchangeCode(code);

    // Store encrypted token in DB
    const db = getSupabase();
    await db.from("splitwise_tokens").upsert(
      { clerk_user_id: userId, access_token: encryptToken(accessToken) },
      { onConflict: "clerk_user_id" }
    );

    const mobileScheme = process.env.MOBILE_APP_SCHEME;
    if (mobileScheme) {
      // Redirect back into the mobile app so UX can show "Importing..." immediately.
      return NextResponse.redirect(
        `${mobileScheme}://settings?splitwise=connected&import=1`
      );
    }

    // Fallback for web-only usage.
    return NextResponse.redirect(new URL("/app/settings?splitwise=connected", req.url));
  } catch (err) {
    console.error("[splitwise] OAuth callback error:", err);
    return NextResponse.redirect(
      new URL("/app/settings?splitwise_error=token_exchange_failed", req.url)
    );
  }
}
