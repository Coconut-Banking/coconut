/**
 * Verify receipt-to-transaction match consistency.
 *
 * Compares what the email-receipts page sees ("Matched to transaction")
 * vs what the transactions page sees (hasReceipt flag).
 *
 * Usage:
 *   npx tsx scripts/verify-receipt-match.ts [userId]
 *
 * Requires .env.local with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function main() {
  const userId = process.argv[2] || await findFirstUser();
  if (!userId) {
    console.error("No userId provided and none found in DB.");
    process.exit(1);
  }
  console.log(`\n🔍 Receipt Match Verification for userId: ${userId}\n`);

  // ─── Side A: What the Email Receipts page sees ─────────────────────────────
  console.log("═══ EMAIL RECEIPTS PAGE (admin client, no RLS) ═══");

  const { data: allReceipts, error: rErr } = await db
    .from("email_receipts")
    .select("id, merchant, amount, date, transaction_id")
    .eq("clerk_user_id", userId)
    .order("date", { ascending: false });

  if (rErr) {
    console.error("  Failed to fetch email_receipts:", rErr.message);
    process.exit(1);
  }

  const totalReceipts = allReceipts?.length ?? 0;
  const matchedReceipts = (allReceipts ?? []).filter((r) => r.transaction_id);
  const unmatchedReceipts = (allReceipts ?? []).filter((r) => !r.transaction_id);

  console.log(`  Total receipts:     ${totalReceipts}`);
  console.log(`  Matched (tx_id set): ${matchedReceipts.length}`);
  console.log(`  Unmatched:          ${unmatchedReceipts.length}`);

  // ─── Check for stale matches (transaction_id points to deleted tx) ─────────
  const matchedTxIds = matchedReceipts.map((r) => r.transaction_id).filter(Boolean) as string[];
  let staleTxIds = new Set<string>();
  if (matchedTxIds.length > 0) {
    const { data: validTxRows } = await db
      .from("transactions")
      .select("id")
      .in("id", matchedTxIds);
    const validIds = new Set((validTxRows ?? []).map((t) => t.id as string));
    for (const tid of matchedTxIds) {
      if (!validIds.has(tid)) staleTxIds.add(tid);
    }
  }
  const staleReceipts = matchedReceipts.filter((r) => staleTxIds.has(r.transaction_id));
  const validMatchedReceipts = matchedReceipts.filter((r) => !staleTxIds.has(r.transaction_id));

  if (staleReceipts.length > 0) {
    console.log(`  ⚠️  STALE matches (tx deleted): ${staleReceipts.length}`);
    for (const r of staleReceipts.slice(0, 5)) {
      console.log(`     → ${r.merchant} $${r.amount} (${r.date}) → tx ${r.transaction_id} MISSING`);
    }
    if (staleReceipts.length > 5) console.log(`     ... and ${staleReceipts.length - 5} more`);
  }
  console.log(`  Valid matches:      ${validMatchedReceipts.length}`);

  // ─── Side B: What the Transactions page sees ───────────────────────────────
  console.log("\n═══ TRANSACTIONS PAGE (simulating /api/plaid/transactions) ═══");

  const { data: allTx, error: tErr } = await db
    .from("transactions")
    .select("id, plaid_transaction_id, merchant_name, raw_name, normalized_merchant, amount, date")
    .eq("clerk_user_id", userId)
    .order("date", { ascending: false })
    .limit(2000);

  if (tErr) {
    console.error("  Failed to fetch transactions:", tErr.message);
    process.exit(1);
  }

  const txCount = allTx?.length ?? 0;
  console.log(`  Total transactions: ${txCount}`);

  // Simulate the receipt lookup the transactions route does
  const { data: linkedReceipts } = await db
    .from("email_receipts")
    .select("id, transaction_id, merchant")
    .eq("clerk_user_id", userId)
    .not("transaction_id", "is", null);

  const receiptByTxId = new Map<string, string>();
  for (const r of linkedReceipts ?? []) {
    if (r.transaction_id) receiptByTxId.set(r.transaction_id as string, r.merchant as string);
  }

  const txIds = new Set((allTx ?? []).map((t) => t.id as string));
  let txWithReceipt = 0;
  let receiptPointsToMissingTx = 0;

  for (const [txId] of receiptByTxId) {
    if (txIds.has(txId)) {
      txWithReceipt++;
    } else {
      receiptPointsToMissingTx++;
    }
  }

  console.log(`  Transactions with hasReceipt=true: ${txWithReceipt}`);
  console.log(`  Receipts pointing to tx NOT in list: ${receiptPointsToMissingTx}`);

  // ─── Now simulate with RLS (user-scoped client) ────────────────────────────
  console.log("\n═══ RLS CHECK: email_receipts via anon key + JWT ═══");
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) {
    console.log("  ⏭️  Skipped (NEXT_PUBLIC_SUPABASE_ANON_KEY not set)");
  } else {
    // We can't easily get a Clerk JWT here, but we can check if RLS is enabled
    const anonDb = createClient(SUPABASE_URL, anonKey, { auth: { persistSession: false } });
    const { data: anonReceipts, error: anonErr } = await anonDb
      .from("email_receipts")
      .select("id")
      .eq("clerk_user_id", userId)
      .not("transaction_id", "is", null)
      .limit(5);

    if (anonErr) {
      console.log(`  ❌ Anon client error: ${anonErr.message}`);
      console.log(`     This confirms RLS blocks access without a valid JWT.`);
      console.log(`     If the transactions route uses user-scoped client, receipts won't load.`);
    } else {
      console.log(`  Anon client returned: ${anonReceipts?.length ?? 0} receipts`);
      if ((anonReceipts?.length ?? 0) === 0 && validMatchedReceipts.length > 0) {
        console.log(`  ⚠️  RLS blocks anon reads → user-scoped client would return 0 receipts`);
      }
    }
  }

  // ─── Comparison ────────────────────────────────────────────────────────────
  console.log("\n═══ COMPARISON ═══");
  console.log(`  Email receipts page shows matched: ${matchedReceipts.length}`);
  console.log(`  Transactions page would show:      ${txWithReceipt}`);
  console.log(`  ─────────────────────────────────`);

  const gap = matchedReceipts.length - txWithReceipt;
  if (gap === 0) {
    console.log(`  ✅ MATCH — both pages agree`);
  } else {
    console.log(`  ❌ GAP of ${gap} receipts`);
    console.log(`     Breakdown:`);
    console.log(`       Stale (tx deleted):           ${staleReceipts.length}`);
    console.log(`       Points to tx outside top 2000: ${receiptPointsToMissingTx - staleReceipts.length}`);
    const rlsGap = gap - staleReceipts.length - Math.max(0, receiptPointsToMissingTx - staleReceipts.length);
    if (rlsGap > 0) {
      console.log(`       Likely RLS mismatch:          ${rlsGap}`);
    }
  }

  // ─── Show some specific mismatched receipts ────────────────────────────────
  if (gap > 0) {
    console.log("\n═══ SAMPLE MISMATCHED RECEIPTS ═══");
    const mismatched = matchedReceipts.filter((r) => {
      if (staleTxIds.has(r.transaction_id)) return true;
      if (!txIds.has(r.transaction_id)) return true;
      return false;
    });
    for (const r of mismatched.slice(0, 10)) {
      const reason = staleTxIds.has(r.transaction_id) ? "STALE (tx deleted)" : "tx not in top 2000";
      console.log(`  ${r.merchant} | $${r.amount} | ${r.date} | ${reason}`);
    }
    if (mismatched.length > 10) {
      console.log(`  ... and ${mismatched.length - 10} more`);
    }
  }

  console.log();
}

async function findFirstUser(): Promise<string | null> {
  const { data } = await db
    .from("email_receipts")
    .select("clerk_user_id")
    .not("transaction_id", "is", null)
    .limit(1);
  return data?.[0]?.clerk_user_id ?? null;
}

main().catch((err) => {
  console.error("Script error:", err);
  process.exit(1);
});
