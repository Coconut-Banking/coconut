import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getPlaidClient } from "@/lib/plaid-client";
import { savePlaidToken, syncTransactionsForUser, embedTransactionsForUser } from "@/lib/transaction-sync";

const DEMO_USER_ID = "demo-sandbox-user";

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  const effectiveUserId = userId ?? DEMO_USER_ID;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { public_token } = body as { public_token?: string };
  if (!public_token) return NextResponse.json({ error: "public_token required" }, { status: 400 });

  const client = getPlaidClient();
  if (!client) return NextResponse.json({ error: "Plaid is not configured" }, { status: 503 });

  try {
    const response = await client.itemPublicTokenExchange({ public_token });
    const { access_token, item_id } = response.data;

    await savePlaidToken(effectiveUserId, access_token, item_id);

    const { synced, error: syncError } = await syncTransactionsForUser(effectiveUserId);
    if (syncError) console.warn("[exchange-token] sync warning:", syncError);
    console.log(`[exchange-token] synced ${synced} transactions for ${effectiveUserId}`);

    embedTransactionsForUser(effectiveUserId).catch((e) =>
      console.error("[exchange-token] background embed failed:", e)
    );

    return NextResponse.json({ ok: true, item_id, synced });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to exchange token";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
