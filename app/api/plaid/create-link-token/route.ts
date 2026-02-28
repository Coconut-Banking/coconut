import { NextResponse } from "next/server";
import { getPlaidClient } from "@/lib/plaid-client";
import { getPlaidConfig } from "@/lib/plaid";
import { Products, CountryCode } from "plaid";

export async function POST() {
  const client = getPlaidClient();
  const { isConfigured } = getPlaidConfig();
  if (!client || !isConfigured) {
    return NextResponse.json(
      { error: "Plaid is not configured. Set PLAID_CLIENT_ID and PLAID_SANDBOX_SECRET in .env.local." },
      { status: 503 }
    );
  }

  try {
    const response = await client.linkTokenCreate({
      user: { client_user_id: "coconut-demo-user" },
      client_name: "Coconut",
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: "en",
    });
    const linkToken = response.data.link_token;
    return NextResponse.json({ link_token: linkToken });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create link token";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
