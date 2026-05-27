export const dynamic = "force-dynamic";
// Cap at 55s — the cron fires every 60s. Keeping under the interval prevents two
// invocations from overlapping and double-processing the same claimed jobs.
export const maxDuration = 55;

import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getSupabase } from "@/lib/supabase";
import { CACHE_TAGS } from "@/lib/cached-queries";

const DAILY_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
let _lastDailyRefreshCheck = 0;
let _lastAutoPayoutCheck = 0;
const AUTO_PAYOUT_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Once per day, find Plaid Items that haven't been refreshed in 24h and sync them
 * with forceRefresh. This ensures no transactions are missed even if webhooks fail.
 * Cost: $0.12 × items × 1/day (e.g. $0.24/day for 2 banks).
 */
async function runDailyRefreshIfNeeded(db: ReturnType<typeof getSupabase>) {
  const now = Date.now();
  if (now - _lastDailyRefreshCheck < 60 * 60 * 1000) return; // Check at most once per hour
  _lastDailyRefreshCheck = now;

  try {
    // Only refresh items that have had NO sync activity (webhook or manual) for 48h+.
    // If last_synced_at is recent, webhooks are working fine — no need to pay $0.12.
    const cutoff = new Date(now - DAILY_REFRESH_INTERVAL_MS * 2).toISOString();
    const { data: staleItems } = await db
      .from("plaid_items")
      .select("clerk_user_id, plaid_item_id, last_refreshed_at, last_synced_at")
      .or(`last_synced_at.is.null,last_synced_at.lt.${cutoff}`)
      .limit(10);

    if (!staleItems || staleItems.length === 0) return;

    const userIds = [...new Set(staleItems.map((i) => i.clerk_user_id as string))];
    console.log("[cron] daily safety-net refresh for", userIds.length, "user(s),", staleItems.length, "item(s)");

    const { syncTransactionsForUser } = await import("@/lib/transaction-sync");
    for (const userId of userIds) {
      try {
        await syncTransactionsForUser(userId, { requestPlaidRefresh: true, forceRefresh: true });
        const { revalidateTag } = await import("next/cache");
        try { revalidateTag(CACHE_TAGS.transactions(userId), "max"); } catch { /* ok */ }
      } catch (e) {
        console.warn("[cron] daily refresh failed for", userId, ":", e instanceof Error ? e.message : e);
      }
    }
  } catch (e) {
    console.warn("[cron] daily refresh check failed:", e instanceof Error ? e.message : e);
  }
}

/** Hourly: payout Connect balances over AUTO_PAYOUT_THRESHOLD_USD to linked banks. */
async function runAutoPayoutsIfNeeded() {
  const now = Date.now();
  if (now - _lastAutoPayoutCheck < AUTO_PAYOUT_CHECK_INTERVAL_MS) return;
  _lastAutoPayoutCheck = now;

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return;

  try {
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(key);
    const db = getSupabase();
    const { runAutoPayoutBatch } = await import("@/lib/stripe-auto-payout");
    const result = await runAutoPayoutBatch({ stripe, db, limit: 30 });
    if (result.triggered > 0 || result.errors > 0) {
      console.log("[cron] auto-payout batch", result);
    }
  } catch (e) {
    console.warn("[cron] auto-payout failed:", e instanceof Error ? e.message : e);
  }
}

/**
 * GET /api/cron/process-jobs
 * Runs every minute via Vercel Cron (requires Hobby plan or above).
 * Claims up to 5 pending jobs and processes them — currently handles:
 *   - plaid_sync: run syncTransactionsForUser for the given clerk_user_id
 *
 * Job lifecycle: pending → processing (locked_at set) → done | failed
 * Jobs stuck in processing for >10 minutes are automatically reclaimed.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getSupabase();

  // Claim pending jobs (or stale processing jobs older than 10 min) atomically.
  // We use a two-step select+update; Vercel cron runs one instance at a time so
  // concurrent processing is not a concern.
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  const { data: jobs, error: claimErr } = await db
    .from("job_queue")
    .select("id, type, payload, clerk_user_id")
    .or(`status.eq.pending,and(status.eq.processing,locked_at.lt.${cutoff})`)
    .order("created_at", { ascending: true })
    .limit(5);

  if (claimErr) {
    console.error("[process-jobs] failed to claim jobs:", claimErr.message);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  if (!jobs || jobs.length === 0) {
    // No pending jobs — check for stale Plaid Items that need a daily safety-net refresh.
    // transactionsRefresh costs $0.12/call so we only do this once per 24h per Item.
    await runDailyRefreshIfNeeded(db);
    await runAutoPayoutsIfNeeded();
    return NextResponse.json({ processed: 0 });
  }

  const jobIds = jobs.map((j) => j.id);
  await db
    .from("job_queue")
    .update({ status: "processing", locked_at: new Date().toISOString() })
    .in("id", jobIds);

  const { syncTransactionsForUser, embedTransactionsForUser, embedRichTransactionsForUser, enrichCategoriesForUser } =
    await import("@/lib/transaction-sync");

  const jobResults = await Promise.all(
    jobs.map(async (job) => {
      const payload = job.payload as Record<string, string>;
      try {
        if (job.type === "plaid_sync") {
          const clerkUserId = payload.clerk_user_id ?? (job.clerk_user_id as string);
          if (!clerkUserId) throw new Error("missing clerk_user_id in payload");

          const r = await syncTransactionsForUser(clerkUserId);
          console.log("[process-jobs] plaid_sync done", {
            user: clerkUserId,
            synced: r.synced,
            webhook_code: payload.webhook_code,
          });

          try { revalidateTag(CACHE_TAGS.transactions(clerkUserId), "max"); } catch { /* ok */ }

          embedTransactionsForUser(clerkUserId).catch((e) =>
            console.warn("[process-jobs] embed failed:", e instanceof Error ? e.message : e)
          );
          embedRichTransactionsForUser(clerkUserId).catch((e) =>
            console.warn("[process-jobs] rich-embed failed:", e instanceof Error ? e.message : e)
          );
          enrichCategoriesForUser(clerkUserId).catch((e) =>
            console.warn("[process-jobs] categorize failed:", e instanceof Error ? e.message : e)
          );
        } else {
          throw new Error(`unknown job type: ${job.type}`);
        }

        await db
          .from("job_queue")
          .update({ status: "done", processed_at: new Date().toISOString() })
          .eq("id", job.id);
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[process-jobs] job failed:", { id: job.id, type: job.type, error: msg });
        await db
          .from("job_queue")
          .update({ status: "failed", error: msg, processed_at: new Date().toISOString() })
          .eq("id", job.id);
        return false;
      }
    })
  );

  const processed = jobResults.filter(Boolean).length;
  const failed = jobResults.filter((r) => !r).length;

  await runAutoPayoutsIfNeeded();

  return NextResponse.json({ processed, failed, total: jobs.length });
}
