export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getEffectiveUserId } from "@/lib/demo";
import { loadClerkAuth, getCachedSupabaseToken } from "@/lib/auth";
import { getSupabaseForUser } from "@/lib/supabase";
import { fetchAllEmailReceiptsLinkedForUser } from "@/lib/transaction-sync";

/**
 * GET /api/debug/receipt-match-verify
 *
 * Diagnostic endpoint that compares what the email-receipts page sees
 * (admin client) vs what the transactions page sees (user-scoped client).
 *
 * DELETE THIS AFTER DEBUGGING.
 */
export async function GET() {
  const session = await loadClerkAuth();
  if (!session.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { userId: clerkUserId, getToken } = session;
  const effectiveUserId = await getEffectiveUserId({ userId: clerkUserId });
  if (!effectiveUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminDb = getSupabaseAdmin();
  const token = clerkUserId ? await getCachedSupabaseToken(getToken, clerkUserId) : null;
  const userDb = getSupabaseForUser(token);

  // ─── Side A: Email Receipts page (admin client) ─────────────────────────
  const { data: allReceipts } = await adminDb
    .from("email_receipts")
    .select("id, merchant, amount, date, transaction_id")
    .eq("clerk_user_id", effectiveUserId)
    .order("date", { ascending: false });

  const totalReceipts = allReceipts?.length ?? 0;
  const matchedReceipts = (allReceipts ?? []).filter((r) => r.transaction_id);
  const unmatchedReceipts = totalReceipts - matchedReceipts.length;

  // Check for stale matches
  const matchedTxIds = matchedReceipts
    .map((r) => r.transaction_id)
    .filter(Boolean) as string[];
  let staleCount = 0;
  const staleExamples: Array<{ merchant: string; amount: number; date: string; transaction_id: string }> = [];
  if (matchedTxIds.length > 0) {
    const { data: validTxRows } = await adminDb
      .from("transactions")
      .select("id")
      .in("id", matchedTxIds);
    const validIds = new Set((validTxRows ?? []).map((t) => t.id as string));
    for (const r of matchedReceipts) {
      if (!validIds.has(r.transaction_id)) {
        staleCount++;
        if (staleExamples.length < 5) {
          staleExamples.push({
            merchant: r.merchant,
            amount: r.amount,
            date: r.date,
            transaction_id: r.transaction_id,
          });
        }
      }
    }
  }

  // ─── Side B: Transactions page receipt lookup (admin client) ────────────
  const { data: allTx } = await adminDb
    .from("transactions")
    .select("id")
    .eq("clerk_user_id", effectiveUserId)
    .order("date", { ascending: false })
    .limit(2000);

  const txIdSet = new Set((allTx ?? []).map((t) => t.id as string));

  const adminReceiptRows = await fetchAllEmailReceiptsLinkedForUser(
    adminDb,
    effectiveUserId,
    "id, transaction_id, merchant"
  );
  let adminTxWithReceipt = 0;
  for (const r of adminReceiptRows) {
    if (r.transaction_id && txIdSet.has(r.transaction_id as string)) {
      adminTxWithReceipt++;
    }
  }

  // ─── Side C: Transactions page receipt lookup (user-scoped client) ──────
  let userTxWithReceipt = 0;
  let userClientError: string | null = null;
  let userReceiptCount = 0;
  if (userDb) {
    try {
      const userReceiptRows = await fetchAllEmailReceiptsLinkedForUser(
        userDb,
        effectiveUserId,
        "id, transaction_id, merchant"
      );
      userReceiptCount = userReceiptRows.length;
      for (const r of userReceiptRows) {
        if (r.transaction_id && txIdSet.has(r.transaction_id as string)) {
          userTxWithReceipt++;
        }
      }
    } catch (e) {
      userClientError = e instanceof Error ? e.message : String(e);
    }
  } else {
    userClientError = "getSupabaseForUser returned null (no token)";
  }

  // ─── Comparison ────────────────────────────────────────────────────────
  const result = {
    userId: effectiveUserId,
    emailReceiptsPage: {
      totalReceipts,
      showingAsMatched: matchedReceipts.length,
      unmatched: unmatchedReceipts,
      staleMatches: staleCount,
      staleExamples,
    },
    transactionsPage: {
      totalTransactions: allTx?.length ?? 0,
      adminClient: {
        receiptRowsReturned: adminReceiptRows.length,
        txWithHasReceipt: adminTxWithReceipt,
      },
      userScopedClient: {
        receiptRowsReturned: userReceiptCount,
        txWithHasReceipt: userTxWithReceipt,
        error: userClientError,
      },
    },
    gap: {
      emailReceiptsShowsMatched: matchedReceipts.length,
      transactionsShowsReceipt_admin: adminTxWithReceipt,
      transactionsShowsReceipt_userScoped: userTxWithReceipt,
      adminVsUserGap: adminTxWithReceipt - userTxWithReceipt,
      diagnosis: adminTxWithReceipt - userTxWithReceipt > 0
        ? "RLS is blocking the user-scoped client from reading email_receipts"
        : staleCount > 0
          ? "Stale matches pointing to deleted transactions"
          : adminTxWithReceipt === matchedReceipts.length
            ? "No gap — both sides agree"
            : "Receipts matched to transactions outside the top 2000",
    },
  };

  return NextResponse.json(result, {
    headers: { "Cache-Control": "no-store" },
  });
}
