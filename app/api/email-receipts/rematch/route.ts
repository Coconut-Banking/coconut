export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getEffectiveUserId } from "@/lib/demo";
import { getSupabase } from "@/lib/supabase";
import { auditAndRematchAllReceipts } from "@/lib/receipt-matcher";

/**
 * POST /api/email-receipts/rematch
 * Audits all existing matches (clears wrong ones where merchant names don't align)
 * and re-matches all unmatched receipts against the full transaction history.
 */
export async function POST() {
  const userId = await getEffectiveUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getSupabase();

  const { count: beforeMatched } = await db
    .from("email_receipts")
    .select("id", { count: "exact", head: true })
    .eq("clerk_user_id", userId)
    .not("transaction_id", "is", null);

  const { count: beforeTotal } = await db
    .from("email_receipts")
    .select("id", { count: "exact", head: true })
    .eq("clerk_user_id", userId);

  const result = await auditAndRematchAllReceipts(userId);

  const { count: afterMatched } = await db
    .from("email_receipts")
    .select("id", { count: "exact", head: true })
    .eq("clerk_user_id", userId)
    .not("transaction_id", "is", null);

  return NextResponse.json({
    ...result,
    before: { total: beforeTotal ?? 0, matched: beforeMatched ?? 0 },
    after: { total: beforeTotal ?? 0, matched: afterMatched ?? 0 },
  });
}
