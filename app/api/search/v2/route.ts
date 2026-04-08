export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
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
    if (process.env.NODE_ENV === 'development') console.log(`[search-v2] auto-backfilling ${count} transactions for ${userId}`);
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
      if (process.env.NODE_ENV === 'development') console.log(`[search-v2] auto-backfill complete for ${userId}`);
    })().catch((e) => { if (process.env.NODE_ENV === 'development') console.warn("[search-v2] auto-backfill error:", e); });
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
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = request.nextUrl.searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json({ error: "Missing query parameter 'q'" }, { status: 400 });
  }

  const dateStartRaw = request.nextUrl.searchParams.get("date_start");
  const dateEndRaw = request.nextUrl.searchParams.get("date_end");
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  if ((dateStartRaw && !ISO_DATE.test(dateStartRaw)) || (dateEndRaw && !ISO_DATE.test(dateEndRaw))) {
    return NextResponse.json({ error: "date_start and date_end must be YYYY-MM-DD" }, { status: 400 });
  }
  const dateStart = dateStartRaw || undefined;
  const dateEnd = dateEndRaw || undefined;
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
    if (process.env.NODE_ENV === 'development') console.error("[search-v2]", err);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
