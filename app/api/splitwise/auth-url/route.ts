export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { getAuthorizationUrl, getSplitwiseConfig } from "@/lib/splitwise";
import { createOAuthState } from "@/lib/paypal-auth";

/**
 * JSON variant of GET /api/splitwise/auth for native apps.
 * React Native fetch often cannot use redirect: "manual", so the client needs the
 * Splitwise authorize URL in the body instead of a 302 Location header.
 */
export async function GET(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { clientId } = getSplitwiseConfig();
  if (!clientId) {
    return NextResponse.json(
      { error: "Splitwise is not configured. Set SPLITWISE_CLIENT_ID and SPLITWISE_CLIENT_SECRET." },
      { status: 503 }
    );
  }

  const returnToApp =
    req.nextUrl.searchParams.get("app") === "1" || req.nextUrl.searchParams.get("mobile") === "1";
  const schemeParam = req.nextUrl.searchParams.get("scheme");
  const appSchemeKey = schemeParam === "coconut-dev" ? "d" : "p";

  const state = createOAuthState(
    userId,
    returnToApp ? { returnToApp: true, appSchemeKey } : undefined
  );
  const url = getAuthorizationUrl(state);

  return NextResponse.json({ url });
}
