import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getPlaidClient } from "@/lib/plaid-client";
import { savePlaidToken, syncTransactionsForUser, embedTransactionsForUser } from "@/lib/transaction-sync";

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { public_token } = body as { public_token?: string };
  if (!public_token) return NextResponse.json({ error: "public_token required" }, { status: 400 });

  const client = getPlaidClient();
  if (!client) return NextResponse.json({ error: "Plaid is not configured" }, { status: 503 });

  try {
    const response = await client.itemPublicTokenExchange({ public_token });
    const { access_token, item_id } = response.data;

    // Persist token to Supabase (per user, replaces .plaid-token.json)
    await savePlaidToken(userId, access_token, item_id);

    // Sync transactions to Supabase (blocking — user waits for this)
    const { synced, error: syncError } = await syncTransactionsForUser(userId);
    if (syncError) console.warn("[exchange-token] sync warning:", syncError);
    console.log(`[exchange-token] synced ${synced} transactions for ${userId}`);

    // Embed in background — don't block the HTTP response
    embedTransactionsForUser(userId).catch((e) =>
      console.error("[exchange-token] background embed failed:", e)
    );

    return NextResponse.json({ ok: true, item_id, synced });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to exchange token";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
