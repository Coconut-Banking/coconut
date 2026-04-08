export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min — fan-out across all users

import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

/**
 * GET /api/cron/receipt-match
 * Nightly Vercel Cron job (runs at 2 AM UTC).
 *
 * For every user with email_scan_enabled:
 *   1. Scan Gmail for new receipt emails from the last 24 hours
 *   2. Match any unmatched receipts from the last 25 hours against transactions
 *      (25h window gives 1h overlap so nothing falls through a timing gap)
 *
 * Secured by CRON_SECRET — Vercel sets Authorization: Bearer <secret> automatically.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getSupabase();

  const { data: connections, error } = await db
    .from("gmail_connections")
    .select("clerk_user_id")
    .eq("email_scan_enabled", true);

  if (error) {
    console.error("[cron/receipt-match] failed to fetch connections:", error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  if (!connections || connections.length === 0) {
    return NextResponse.json({ users: 0, scanned: 0, matched: 0 });
  }

  const { scanGmailForReceipts } = await import("@/lib/receipt-parser");
  const { matchReceiptsToTransactions } = await import("@/lib/receipt-matcher");
  const { mapWithConcurrency } = await import("@/lib/retry");

  // Process users in parallel with bounded concurrency (8) to avoid exhausting
  // Supabase connections and OpenAI rate limits while still beating the 5-min timeout.
  const perUserResults = await mapWithConcurrency(
    connections,
    async ({ clerk_user_id }) => {
      let scanned = 0;
      let matched = 0;
      try {
        // Step 1: scan Gmail for the last 24 hours
        const scanResult = await scanGmailForReceipts(clerk_user_id, 1, false, false);
        scanned = scanResult.inserted;

        // Step 2: match unmatched receipts from the last 25 hours (1h overlap buffer)
        const cutoff = new Date();
        cutoff.setHours(cutoff.getHours() - 25);

        const { data: unmatched } = await db
          .from("email_receipts")
          .select("id")
          .eq("clerk_user_id", clerk_user_id)
          .is("transaction_id", null)
          .gte("parsed_at", cutoff.toISOString());

        if (unmatched && unmatched.length > 0) {
          matched = await matchReceiptsToTransactions(
            clerk_user_id,
            unmatched.map((r) => r.id)
          );
        }
        return { scanned, matched, failed: false };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[cron/receipt-match] user ${clerk_user_id} failed:`, msg);
        return { scanned, matched, failed: true };
      }
    },
    8
  );

  const totalScanned = perUserResults.reduce((s, r) => s + r.scanned, 0);
  const totalMatched = perUserResults.reduce((s, r) => s + r.matched, 0);
  const errorCount = perUserResults.filter((r) => r.failed).length;

  console.log(
    `[cron/receipt-match] done — ${connections.length} users, ${totalScanned} new receipts, ${totalMatched} matched, ${errorCount} errors`
  );

  return NextResponse.json({
    users: connections.length,
    scanned: totalScanned,
    matched: totalMatched,
    errors: errorCount,
  });
}
