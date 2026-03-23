export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getSupabase } from "@/lib/supabase";
import { getEffectiveUserId } from "@/lib/demo";
import { CACHE_TAGS } from "@/lib/cached-queries";

/**
 * Read-only snapshot for debugging stale / missing transactions.
 * Call while signed in (browser session or Authorization: Bearer).
 *
 * Optional: ?sync=1 runs POST-equivalent sync (slow) — use sparingly.
 */
export async function GET(request: Request) {
  const effectiveUserId = await getEffectiveUserId();
  if (!effectiveUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const runSync = url.searchParams.get("sync") === "1";

  const db = getSupabase();

  const { data: items, error: itemsError } = await db
    .from("plaid_items")
    .select("plaid_item_id, institution_name, institution_id, needs_reauth, new_accounts_available")
    .eq("clerk_user_id", effectiveUserId);

  if (itemsError) {
    return NextResponse.json(
      { error: "Failed to load plaid_items", detail: itemsError.message },
      { status: 500 }
    );
  }

  async function loadTxSnapshot() {
    const { count: c, error: countErr } = await db
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("clerk_user_id", effectiveUserId)
      .not("plaid_transaction_id", "like", "manual_%");

    if (countErr) {
      return { error: countErr.message as string };
    }

    const { count: pend } = await db
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("clerk_user_id", effectiveUserId)
      .eq("is_pending", true)
      .not("plaid_transaction_id", "like", "manual_%");

    const { data: latest } = await db
      .from("transactions")
      .select("date, merchant_name, raw_name, is_pending")
      .eq("clerk_user_id", effectiveUserId)
      .not("plaid_transaction_id", "like", "manual_%")
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: oldest } = await db
      .from("transactions")
      .select("date")
      .eq("clerk_user_id", effectiveUserId)
      .not("plaid_transaction_id", "like", "manual_%")
      .order("date", { ascending: true })
      .limit(1)
      .maybeSingle();

    return {
      txCount: c ?? 0,
      pendingCount: pend ?? 0,
      latestRow: latest,
      oldestRow: oldest,
    };
  }

  const first = await loadTxSnapshot();
  if ("error" in first) {
    return NextResponse.json(
      { error: "Failed to count transactions", detail: first.error },
      { status: 500 }
    );
  }

  let { txCount, pendingCount, latestRow, oldestRow } = first;

  let syncResult: { synced?: number; error?: string } | null = null;
  if (runSync) {
    try {
      const { syncTransactionsForUser } = await import("@/lib/transaction-sync");
      syncResult = await syncTransactionsForUser(effectiveUserId);
      if (!syncResult.error) {
        try {
          revalidateTag(CACHE_TAGS.transactions(effectiveUserId), "max");
        } catch {
          /* non-fatal */
        }
        const after = await loadTxSnapshot();
        if (!("error" in after)) {
          txCount = after.txCount;
          pendingCount = after.pendingCount;
          latestRow = after.latestRow;
          oldestRow = after.oldestRow;
        }
      }
    } catch (e) {
      syncResult = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  const linked = (items?.length ?? 0) > 0;

  return NextResponse.json({
    ok: true,
    user_hint: effectiveUserId.slice(0, 12) + "…",
    linked,
    items: (items ?? []).map((r) => ({
      plaid_item_id: r.plaid_item_id,
      institution_name: r.institution_name,
      institution_id: r.institution_id,
      needs_reauth: r.needs_reauth,
      new_accounts_available: r.new_accounts_available,
    })),
    transactions: {
      bank_row_count: txCount ?? 0,
      pending_count: pendingCount ?? 0,
      latest_bank_date: latestRow?.date ?? null,
      latest_merchant_preview:
        (latestRow?.merchant_name || latestRow?.raw_name || "").slice(0, 80) || null,
      oldest_bank_date: oldestRow?.date ?? null,
    },
    hints: [
      !linked
        ? "No plaid_items — connect a bank on /connect."
        : (txCount ?? 0) === 0
          ? "Linked but 0 bank txs: first open triggers sync-on-read; or call POST /api/plaid/transactions or pull-to-refresh in the app."
          : "If dates look old: ensure Plaid webhooks hit /api/plaid/webhook (see docs/PLAID_SYNC_TESTING.md) and try pull-to-refresh (full Plaid sync).",
    ],
    ...(runSync && { sync: syncResult }),
  });
}
