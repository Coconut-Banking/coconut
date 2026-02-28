import { NextRequest, NextResponse } from "next/server";
import { getPlaidClient } from "@/lib/plaid-client";
import { setPlaidAccessToken } from "@/lib/plaid-client";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { public_token } = body as { public_token?: string };
  if (!public_token) {
    return NextResponse.json({ error: "public_token required" }, { status: 400 });
  }

  const client = getPlaidClient();
  if (!client) {
    return NextResponse.json({ error: "Plaid is not configured" }, { status: 503 });
  }

  try {
    const response = await client.itemPublicTokenExchange({
      public_token,
    });
    const accessToken = response.data.access_token;
    const itemId = response.data.item_id;
    setPlaidAccessToken(accessToken, itemId);
    return NextResponse.json({ ok: true, item_id: itemId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to exchange token";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
