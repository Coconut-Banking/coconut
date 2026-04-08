export const dynamic = "force-dynamic";
// Cap at 55s — the cron fires every 60s. Keeping under the interval prevents two
// invocations from overlapping and double-processing the same claimed jobs.
export const maxDuration = 55;

import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getSupabase } from "@/lib/supabase";
import { CACHE_TAGS } from "@/lib/cached-queries";

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
    return NextResponse.json({ processed: 0 });
  }

  const jobIds = jobs.map((j) => j.id);
  await db
    .from("job_queue")
    .update({ status: "processing", locked_at: new Date().toISOString() })
    .in("id", jobIds);

  const { syncTransactionsForUser, embedTransactionsForUser, embedRichTransactionsForUser, enrichCategoriesForUser } =
    await import("@/lib/transaction-sync");

  let processed = 0;
  let failed = 0;

  for (const job of jobs) {
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

        // Fire-and-forget enrichment (same pattern as POST /api/plaid/transactions)
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
        // Unknown type: throw so the job lands in `failed` and is visible in the queue.
        // Silently marking it `done` would hide misconfiguration bugs.
        throw new Error(`unknown job type: ${job.type}`);
      }

      await db
        .from("job_queue")
        .update({ status: "done", processed_at: new Date().toISOString() })
        .eq("id", job.id);
      processed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[process-jobs] job failed:", { id: job.id, type: job.type, error: msg });
      await db
        .from("job_queue")
        .update({ status: "failed", error: msg, processed_at: new Date().toISOString() })
        .eq("id", job.id);
      failed++;
    }
  }

  return NextResponse.json({ processed, failed, total: jobs.length });
}
