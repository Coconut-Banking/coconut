export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getEffectiveUserId } from "@/lib/demo";
import { auditAndRematchAllReceipts } from "@/lib/receipt-matcher";

/**
 * POST /api/email-receipts/rematch
 * Audits all existing matches (clears wrong ones where merchant names don't align)
 * and re-matches all unmatched receipts against the full transaction history.
 */
export async function POST() {
  const userId = await getEffectiveUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await auditAndRematchAllReceipts(userId);

  return NextResponse.json(result);
}
