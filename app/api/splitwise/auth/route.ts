export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { getAuthorizationUrl, getSplitwiseConfig } from "@/lib/splitwise";
import { createOAuthState } from "@/lib/paypal-auth";

export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { clientId } = getSplitwiseConfig();
  if (!clientId) {
    return NextResponse.json(
      { error: "Splitwise is not configured. Set SPLITWISE_CLIENT_ID and SPLITWISE_CLIENT_SECRET." },
      { status: 503 }
    );
  }

  const state = createOAuthState(userId);
  const url = getAuthorizationUrl(state);

  return NextResponse.redirect(url);
}
