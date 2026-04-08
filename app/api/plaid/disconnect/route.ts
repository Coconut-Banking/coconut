export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getSupabase } from "@/lib/supabase";
import { getEffectiveUserId } from "@/lib/demo";
import { getPlaidClient } from "@/lib/plaid-client";
import { decryptToken } from "@/lib/encryption";
import { CACHE_TAGS } from "@/lib/cached-queries";

/**
 * POST /api/plaid/disconnect
 * Removes Plaid connection and all bank transactions for the user.
 * Calls Plaid item/remove per Item to stop billing and invalidate tokens.
 */
export async function POST() {
  const effectiveUserId = await getEffectiveUserId();
  if (!effectiveUserId) {
    return NextResponse.json({ error: "Sign in to manage your bank" }, { status: 401 });
  }

  try {
    const db = getSupabase();

    // Call item/remove so Plaid stops billing
    const { data: items } = await db.from("plaid_items").select("access_token").eq("clerk_user_id", effectiveUserId);
    const plaid = getPlaidClient();
    if (plaid && items?.length) {
      await Promise.allSettled(
        items
          .filter((item) => item.access_token)
          .map(async (item) => {
            const token = decryptToken(item.access_token as string);
            try {
              await plaid.itemRemove({ access_token: token });
              console.log("[disconnect] itemRemove ok", { user_id: effectiveUserId });
            } catch (e) {
              console.warn("[disconnect] itemRemove failed (token may be invalid):", e instanceof Error ? e.message : e);
            }
          })
      );
    }

    // Clear email_receipts FK before deleting transactions (prevents FK violation)
    try {
      await db.from("email_receipts").update({ transaction_id: null }).eq("clerk_user_id", effectiveUserId);
    } catch { /* table may not exist */ }

    // Get all user's transaction IDs first
    const { data: allTx } = await db
      .from("transactions")
      .select("id, plaid_transaction_id")
      .eq("clerk_user_id", effectiveUserId);
    const userTxIds = (allTx ?? []).map((r) => r.id as string);

    // 1. Delete subscription_transactions before subscriptions to avoid FK violations,
    //    and before bank transactions so subscription FK refs are cleared first.
    const { data: userSubs } = await db
      .from("subscriptions")
      .select("id")
      .eq("clerk_user_id", effectiveUserId);
    if (userSubs && userSubs.length > 0) {
      await db
        .from("subscription_transactions")
        .delete()
        .in("subscription_id", userSubs.map((s: { id: string }) => s.id));
    }

    // 2. Delete subscriptions (will be re-detected on reconnect)
    await db.from("subscriptions").delete().eq("clerk_user_id", effectiveUserId);

    // 2b. Clear any remaining subscription_transactions rows referencing this user's
    //     transactions by transaction_id FK (may exist if subscription_id was null
    //     or belonged to a different subscription record from a prior partial run).
    //     Must happen before deleting transactions to avoid ON DELETE RESTRICT FK violations.
    if (userTxIds.length > 0) {
      const CHUNK = 100;
      await Promise.all(
        Array.from({ length: Math.ceil(userTxIds.length / CHUNK) }, (_, i) =>
          db
            .from("subscription_transactions")
            .delete()
            .in("transaction_id", userTxIds.slice(i * CHUNK, (i + 1) * CHUNK))
        )
      );
    }

    // 3. Protect bank transactions that are still referenced by split_transactions
    //    (subscription FK refs are already gone at this point)
    const { data: inSplits } = await db
      .from("split_transactions")
      .select("transaction_id")
      .in("transaction_id", userTxIds);
    const protectedIds = new Set(
      (inSplits ?? []).map((r) => r.transaction_id as string).filter(Boolean)
    );

    // 4. Delete only bank transactions (keep manual expenses from Shared)
    const bankIds = (allTx ?? [])
      .filter((r) => !String(r.plaid_transaction_id || "").startsWith("manual_"))
      .filter((r) => !protectedIds.has(r.id as string))
      .map((r) => r.id);
    if (bankIds.length > 0) {
      await db.from("transactions").delete().in("id", bankIds);
    }

    // Delete accounts and plaid_items in parallel
    const [, { error }] = await Promise.all([
      db.from("accounts").delete().eq("clerk_user_id", effectiveUserId),
      db.from("plaid_items").delete().eq("clerk_user_id", effectiveUserId),
    ]);
    if (error) {
      console.error("[disconnect] plaid_items delete error:", error);
      return NextResponse.json({ error: "Disconnect failed" }, { status: 500 });
    }

    revalidateTag(CACHE_TAGS.transactions(effectiveUserId), "max");
    revalidateTag(CACHE_TAGS.splitTransactions(effectiveUserId), "max");

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[disconnect]", err);
    return NextResponse.json({ error: "Disconnect failed" }, { status: 500 });
  }
}
