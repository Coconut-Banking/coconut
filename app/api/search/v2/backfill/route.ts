export const dynamic = "force-dynamic";
/**
 * Backfill endpoint for search v2.
 *
 * Populates the NEW columns (rich_embedding, embed_text) for existing
 * transactions where they are NULL. Never touches the existing `embedding`
 * column or any other existing data.
 *
 * Usage: POST /api/search/v2/backfill
 *
 * This is an authenticated endpoint — only backfills the calling user's
 * transactions.
 */
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { embedRichTransactionsForUser } from "@/lib/transaction-sync";

export async function POST() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await embedRichTransactionsForUser(userId);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[search-v2/backfill]", err);
    return NextResponse.json({ error: "Backfill failed" }, { status: 500 });
  }
}
