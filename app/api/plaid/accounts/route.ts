import { NextResponse } from "next/server";
import { getPlaidClient } from "@/lib/plaid-client";
import { getPlaidAccessToken } from "@/lib/plaid-client";

export async function GET() {
  const accessToken = getPlaidAccessToken();
  if (!accessToken) {
    return NextResponse.json({ error: "Not linked" }, { status: 401 });
  }

  const client = getPlaidClient();
  if (!client) {
    return NextResponse.json({ error: "Plaid not configured" }, { status: 503 });
  }

  try {
    const response = await client.accountsGet({
      access_token: accessToken,
    });
    return NextResponse.json(response.data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to get accounts";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
