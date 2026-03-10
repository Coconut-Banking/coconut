import { NextResponse } from "next/server";
import { getPlaidClient } from "@/lib/plaid-client";
import { getPlaidConfig } from "@/lib/plaid";
import { Products, CountryCode } from "plaid";
import { getEffectiveUserId } from "@/lib/demo";
import { SYNC } from "@/lib/config";

export async function POST() {
  const effectiveUserId = await getEffectiveUserId();
  if (!effectiveUserId) {
    return NextResponse.json({ error: "Sign in to connect your bank" }, { status: 401 });
  }

  const client = getPlaidClient();
  const { isConfigured, env } = getPlaidConfig();
  if (!client || !isConfigured) {
    return NextResponse.json(
      { error: "Plaid is not configured. Set PLAID_CLIENT_ID and PLAID_SANDBOX_SECRET in .env.local." },
      { status: 503 }
    );
  }

  // Use redirect flow for OAuth banks (Chase, etc.) — fixes mobile "stuck" when popup fails
  let baseUrl =
    process.env.APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
    "http://localhost:3000";
  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
    baseUrl = `https://${baseUrl}`;
  }
  const redirectUri = `${baseUrl.replace(/\/$/, "")}/connect`;

  try {
    const response = await client.linkTokenCreate({
      user: { client_user_id: effectiveUserId },
      client_name: "Coconut",
      products: [Products.Transactions],
      country_codes: [CountryCode.Us, CountryCode.Ca],
      language: "en",
      transactions: { days_requested: SYNC.PLAID_HISTORY_DAYS },
      redirect_uri: redirectUri,
    });
    return NextResponse.json({
      link_token: response.data.link_token,
      plaid_env: env,
    });
  } catch (err: unknown) {
    console.error("Plaid link token error:", err);
    return NextResponse.json(
      { error: "Failed to create link token" },
      { status: 500 }
    );
  }
}
