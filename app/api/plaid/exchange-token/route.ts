import { NextRequest, NextResponse } from "next/server";
import { getPlaidClient } from "@/lib/plaid-client";
import { savePlaidToken, syncTransactionsForUser, embedTransactionsForUser } from "@/lib/transaction-sync";
import { getEffectiveUserId } from "@/lib/demo";

export async function POST(request: NextRequest) {
  const effectiveUserId = await getEffectiveUserId();
  if (!effectiveUserId) {
    return NextResponse.json({ error: "Sign in to connect your bank" }, { status: 401 });
  }

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

    // In production, clear stale/sandbox tx first so only real bank data remains
    if (process.env.NODE_ENV === "production") {
      const { getSupabase } = await import("@/lib/supabase");
      const db = getSupabase();
      const { data: inSplits } = await db.from("split_transactions").select("transaction_id");
      const protectedIds = new Set((inSplits ?? []).map((r) => r.transaction_id as string));
      const { data: toDelete } = await db
        .from("transactions")
        .select("id, plaid_transaction_id")
        .eq("clerk_user_id", effectiveUserId);
      const idsToDelete = (toDelete ?? [])
        .filter((r) => !String(r.plaid_transaction_id || "").startsWith("manual_"))
        .map((r) => r.id as string)
        .filter((id) => !protectedIds.has(id));
      if (idsToDelete.length > 0) {
        await db.from("transactions").delete().in("id", idsToDelete);
      }
    }
    let synced = 0;
    let syncError: string | undefined;
    // Plaid can return 0 immediately after OAuth handoff; retry a couple times.
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 3000 * attempt)); // 3s, then 6s
      }
      const result = await syncTransactionsForUser(effectiveUserId);
      synced = result.synced;
      syncError = result.error;
      if (syncError) console.warn(`[exchange-token] sync warning (attempt ${attempt + 1}):`, syncError);
      console.log(`[exchange-token] attempt ${attempt + 1} synced ${synced} transactions for ${effectiveUserId}`);
      if (synced > 0) break;
    }

    embedTransactionsForUser(effectiveUserId).catch((e) =>
      console.error("[exchange-token] background embed failed:", e)
    );

    return NextResponse.json({ ok: true, item_id, synced });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to exchange token";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
