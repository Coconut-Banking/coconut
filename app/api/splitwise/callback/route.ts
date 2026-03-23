export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { exchangeCode } from "@/lib/splitwise";
import { getSupabase } from "@/lib/supabase";

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

  try {
    const accessToken = await exchangeCode(code);

    // Store token in DB
    const db = getSupabase();
    await db.from("splitwise_tokens").upsert(
      { clerk_user_id: userId, access_token: accessToken },
      { onConflict: "clerk_user_id" }
    );

    return NextResponse.redirect(new URL("/app/settings?splitwise=connected", req.url));
  } catch (err) {
    console.error("[splitwise] OAuth callback error:", err);
    return NextResponse.redirect(
      new URL("/app/settings?splitwise_error=token_exchange_failed", req.url)
    );
  }
}
