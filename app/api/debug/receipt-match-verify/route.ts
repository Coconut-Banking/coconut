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
    .select("id, merchant_name, raw_name, normalized_merchant, amount, date, plaid_transaction_id, is_pending, source")
    .eq("clerk_user_id", effectiveUserId)
    .order("date", { ascending: false })
    .limit(2000);

  const txIdSet = new Set((allTx ?? []).map((t) => t.id as string));

  // Apply same dedup the transactions route uses (merchant+amount+date)
  const bankOnly = (allTx ?? []).filter((tx) => {
    const pid = (tx.plaid_transaction_id as string) || "";
    return !pid.startsWith("manual_");
  });
  const keptIds = new Set<string>();
  const duplicateIdToKeptId = new Map<string, string>();
  const keyToKeptId = new Map<string, string>();
  const dedupedIds = new Set<string>();
  for (const tx of bankOnly) {
    const raw = ((tx.merchant_name || tx.raw_name || "") as string).trim().toLowerCase();
    const norm = (tx.normalized_merchant as string) ?? raw.replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
    const merchant = norm || raw;
    const amount = Number(tx.amount);
    const date = tx.date as string;
    const key = `${merchant}|${amount}|${date}`;
    const tid = tx.id as string;
    const existingKept = keyToKeptId.get(key);
    if (existingKept !== undefined) {
      duplicateIdToKeptId.set(tid, existingKept);
    } else {
      keyToKeptId.set(key, tid);
      keptIds.add(tid);
      dedupedIds.add(tid);
    }
  }

  const adminReceiptRows = await fetchAllEmailReceiptsLinkedForUser(
    adminDb,
    effectiveUserId,
    "id, transaction_id, merchant"
  );

  // Pre-dedup count: receipt tx_id is in any tx (like old diagnostic)
  let adminTxWithReceipt = 0;
  for (const r of adminReceiptRows) {
    if (r.transaction_id && txIdSet.has(r.transaction_id as string)) {
      adminTxWithReceipt++;
    }
  }

  // Post-dedup count: receipt tx_id is in the deduped set (simulates actual API)
  let adminTxWithReceiptPostDedup = 0;
  const receiptOnDupTx: Array<{ receiptId: string; merchant: string; dupTxId: string; keptTxId: string }> = [];
  for (const r of adminReceiptRows) {
    const tid = r.transaction_id as string;
    if (!tid) continue;
    if (dedupedIds.has(tid)) {
      adminTxWithReceiptPostDedup++;
    } else if (duplicateIdToKeptId.has(tid)) {
      receiptOnDupTx.push({
        receiptId: r.id as string,
        merchant: r.merchant as string,
        dupTxId: tid,
        keptTxId: duplicateIdToKeptId.get(tid)!,
      });
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

  // ─── Deep dive: check each matched receipt's transaction ──────────────
  const orphanDetails: Array<{
    receiptId: string;
    merchant: string;
    amount: number;
    date: string;
    transaction_id: string;
    txExists: boolean;
    txBelongsToUser: boolean;
    txOwner: string | null;
    txMerchant: string | null;
    txAmount: number | null;
    txDate: string | null;
  }> = [];

  if (matchedTxIds.length > 0) {
    const { data: txDetails } = await adminDb
      .from("transactions")
      .select("id, clerk_user_id, merchant_name, raw_name, normalized_merchant, amount, date, plaid_transaction_id")
      .in("id", matchedTxIds);

    const txDetailMap = new Map(
      (txDetails ?? []).map((t) => [t.id as string, t])
    );

    for (const r of matchedReceipts) {
      const tx = txDetailMap.get(r.transaction_id as string);
      const inUserList = txIdSet.has(r.transaction_id as string);

      if (!inUserList) {
        orphanDetails.push({
          receiptId: r.id,
          merchant: r.merchant,
          amount: r.amount,
          date: r.date,
          transaction_id: r.transaction_id,
          txExists: !!tx,
          txBelongsToUser: tx ? (tx.clerk_user_id === effectiveUserId) : false,
          txOwner: tx ? (tx.clerk_user_id as string) : null,
          txMerchant: tx ? ((tx.merchant_name || tx.raw_name || tx.normalized_merchant) as string) : null,
          txAmount: tx ? (tx.amount as number) : null,
          txDate: tx ? (tx.date as string) : null,
        });
      }
    }
  }

  // ─── Check if orphan txIds were filtered out by manual/pending/dedup ────
  const orphanTxIds = orphanDetails
    .filter((o) => o.txExists && o.txBelongsToUser)
    .map((o) => o.transaction_id);
  let filteredOutReasons: Record<string, string> = {};
  if (orphanTxIds.length > 0) {
    const { data: orphanTxRows } = await adminDb
      .from("transactions")
      .select("id, plaid_transaction_id, is_pending, normalized_merchant, amount, date")
      .in("id", orphanTxIds);
    for (const tx of orphanTxRows ?? []) {
      const pid = tx.plaid_transaction_id as string || "";
      if (pid.startsWith("manual_")) {
        filteredOutReasons[tx.id as string] = "manual expense (filtered out)";
      } else if (tx.is_pending) {
        filteredOutReasons[tx.id as string] = "pending transaction (may be deduped with posted)";
      } else {
        const norm = (tx.normalized_merchant as string) || "";
        const key = `${norm}|${tx.amount}|${tx.date}`;
        filteredOutReasons[tx.id as string] = `deduped? key=${key}`;
      }
    }
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
      totalAfterDedup: dedupedIds.size,
      duplicatesRemoved: duplicateIdToKeptId.size,
      adminClient: {
        receiptRowsReturned: adminReceiptRows.length,
        txWithHasReceipt: adminTxWithReceipt,
        txWithHasReceiptPostDedup: adminTxWithReceiptPostDedup,
        receiptsOnDuplicateTx: receiptOnDupTx.length,
        receiptsOnDuplicateTxDetails: receiptOnDupTx,
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
      orphanReceipts: orphanDetails.length,
      orphanBreakdown: {
        txDeleted: orphanDetails.filter((o) => !o.txExists).length,
        txWrongUser: orphanDetails.filter((o) => o.txExists && !o.txBelongsToUser).length,
        txFilteredOut: orphanDetails.filter((o) => o.txExists && o.txBelongsToUser).length,
      },
    },
    orphanDetails: orphanDetails.map((o) => ({
      ...o,
      filterReason: filteredOutReasons[o.transaction_id] || null,
      txOwner: o.txOwner ? (o.txOwner === effectiveUserId ? "SAME_USER" : "DIFFERENT_USER") : null,
    })),
  };

  return NextResponse.json(result, {
    headers: { "Cache-Control": "no-store" },
  });
}
