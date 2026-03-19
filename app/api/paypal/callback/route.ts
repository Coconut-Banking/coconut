import { NextRequest, NextResponse } from "next/server";
import { exchangeCode, savePayPalTokens } from "@/lib/paypal-auth";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state"); // clerk_user_id

  if (!code || !state) {
    return NextResponse.redirect(new URL("/app/settings?paypal=error", request.url));
  }

  try {
    const tokens = await exchangeCode(code);

    // Fetch user info to get email
    let email: string | undefined;
    let payerId: string | undefined;
    try {
      const userInfoRes = await fetch(
        `${process.env.PAYPAL_ENV === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com"}/v1/identity/openidconnect/userinfo?schema=openid`,
        { headers: { Authorization: `Bearer ${tokens.access_token}` } }
      );
      if (userInfoRes.ok) {
        const info = await userInfoRes.json();
        email = info.email;
        payerId = info.payer_id;
      }
    } catch {
      // Non-critical: continue without email
    }

    await savePayPalTokens(state, tokens, email, payerId);
    return NextResponse.redirect(new URL("/app/settings?paypal=connected", request.url));
  } catch (err) {
    console.error("[paypal/callback] Error:", err);
    return NextResponse.redirect(new URL("/app/settings?paypal=error", request.url));
  }
}
