/**
 * POST /api/cards/create-link-token
 * Creates a Plaid link token for the credit card recommendation tool.
 * Does NOT require authentication — this is for new (non-Coconut) users.
 * Uses a random client_user_id so Plaid doesn't reject the request.
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getPlaidClient } from "@/lib/plaid-client";
import { getPlaidConfig } from "@/lib/plaid";
import { Products, CountryCode } from "plaid";
import { rateLimit } from "@/lib/rate-limit";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = rateLimit(`cards-link-token:${ip}`, 10, 60_000);
  if (!rl.success) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const client = getPlaidClient();
  const { isConfigured, env } = getPlaidConfig();

  if (!client || !isConfigured) {
    return NextResponse.json(
      { error: "Plaid is not configured on this server" },
      { status: 503 }
    );
  }

  // Generate an anonymous client user ID for this session
  const anonUserId = `card_tool_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  const appUrl = process.env.APP_URL ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  const redirectUri = `${appUrl}/plaid-oauth`;

  try {
    const response = await client.linkTokenCreate({
      user: { client_user_id: anonUserId },
      client_name: "Coconut Card Finder",
      products: [Products.Transactions],
      country_codes: [CountryCode.Us, CountryCode.Ca],
      language: "en",
      transactions: { days_requested: 90 },
      redirect_uri: redirectUri,
    });

    return NextResponse.json({ link_token: response.data.link_token, plaid_env: env });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[cards/create-link-token] error:", message);
    return NextResponse.json({ error: "Failed to create link token" }, { status: 500 });
  }
}
