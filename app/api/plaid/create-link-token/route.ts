import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getPlaidClient } from "@/lib/plaid-client";
import { getPlaidConfig } from "@/lib/plaid";
import { Products, CountryCode } from "plaid";

const DEMO_USER_ID = "demo-sandbox-user";

export async function POST() {
  const { userId } = await auth();
  const effectiveUserId = userId ?? DEMO_USER_ID;

  const client = getPlaidClient();
  const { isConfigured } = getPlaidConfig();
  if (!client || !isConfigured) {
    return NextResponse.json(
      { error: "Plaid is not configured. Set PLAID_CLIENT_ID and PLAID_SANDBOX_SECRET in .env.local." },
      { status: 503 }
    );
  }

  // Use redirect flow for OAuth banks (Chase, etc.) — fixes mobile "stuck" when popup fails
  const baseUrl =
    process.env.APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
    "http://localhost:3000";
  const redirectUri = `${baseUrl.replace(/\/$/, "")}/connect`;

  try {
    const response = await client.linkTokenCreate({
      user: { client_user_id: effectiveUserId },
      client_name: "Coconut",
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: "en",
      transactions: { days_requested: 730 },
      redirect_uri: redirectUri,
    });
    return NextResponse.json({ link_token: response.data.link_token });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create link token";
    const hint =
      message.toLowerCase().includes("redirect") || message.includes("400")
        ? ` Add ${redirectUri} to Plaid Dashboard → API → Allowed redirect URIs.`
        : "";
    return NextResponse.json(
      { error: message + hint },
      { status: 500 }
    );
  }
}
