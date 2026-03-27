export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { searchV2 } from "@/lib/search/engine";
import { getSupabaseAdmin } from "@/lib/supabase";
import { embedRichTransactionsForUser } from "@/lib/transaction-sync";

const backfilledUsers = new Set<string>();

async function ensureRichEmbeddings(userId: string): Promise<void> {
  if (backfilledUsers.has(userId)) return;
  backfilledUsers.add(userId);

  const db = getSupabaseAdmin();
  const { count } = await db
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("clerk_user_id", userId)
    .is("rich_embedding", null);

  if (count && count > 0) {
    console.log(`[search-v2] auto-backfilling ${count} transactions for ${userId}`);
    const MAX_PASSES = Math.ceil(count / 1000) + 1;
    (async () => {
      for (let pass = 0; pass < MAX_PASSES; pass++) {
        await embedRichTransactionsForUser(userId);
        const { count: left } = await db
          .from("transactions")
          .select("id", { count: "exact", head: true })
          .eq("clerk_user_id", userId)
          .is("rich_embedding", null);
        if (!left || left === 0) break;
      }
      console.log(`[search-v2] auto-backfill complete for ${userId}`);
    })().catch((e) => console.warn("[search-v2] auto-backfill error:", e));
  }
}

/**
 * GET /api/search/v2
 *
 * Query params:
 *   q           — natural language search query (required)
 *   date_start  — explicit start date YYYY-MM-DD (optional, from calendar picker)
 *   date_end    — explicit end date YYYY-MM-DD (optional, from calendar picker)
 *   account_id  — filter to a specific bank account UUID (optional)
 *
 * When date_start/date_end are provided by the mobile app, they override
 * any date range the LLM extracts from the query text. This gives the
 * calendar UI full control over the date window.
 */
export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = request.nextUrl.searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json({ error: "Missing query parameter 'q'" }, { status: 400 });
  }

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const rawDateStart = request.nextUrl.searchParams.get("date_start");
  const rawDateEnd = request.nextUrl.searchParams.get("date_end");
  const dateStart = rawDateStart && DATE_RE.test(rawDateStart) ? rawDateStart : undefined;
  const dateEnd = rawDateEnd && DATE_RE.test(rawDateEnd) ? rawDateEnd : undefined;
  const accountId = request.nextUrl.searchParams.get("account_id") || undefined;
  const rawLocation = request.nextUrl.searchParams.get("location");
  const location = rawLocation ? rawLocation.trim().slice(0, 100) : undefined;

  ensureRichEmbeddings(userId).catch(() => {});

  try {
    const result = await searchV2(userId, q, {
      dateOverride: dateStart && dateEnd ? { start: dateStart, end: dateEnd } : undefined,
      accountId,
      location,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[search-v2]", err);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
