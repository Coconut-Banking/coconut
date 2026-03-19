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
    // Run in background — don't block the search response
    (async () => {
      let remaining = count;
      while (remaining > 0) {
        await embedRichTransactionsForUser(userId);
        const { count: left } = await db
          .from("transactions")
          .select("id", { count: "exact", head: true })
          .eq("clerk_user_id", userId)
          .is("rich_embedding", null);
        remaining = left ?? 0;
      }
      console.log(`[search-v2] auto-backfill complete for ${userId}`);
    })().catch((e) => console.warn("[search-v2] auto-backfill error:", e));
  }
}

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = request.nextUrl.searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json({ error: "Missing query parameter 'q'" }, { status: 400 });
  }

  // Auto-backfill rich embeddings on first search (fire-and-forget)
  ensureRichEmbeddings(userId).catch(() => {});

  try {
    const result = await searchV2(userId, q);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[search-v2]", err);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
