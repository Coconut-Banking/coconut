import { getSupabase } from "./supabase";

export function normalizeMerchant(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

export function extractKeyword(merchant: string): string | null {
  const normalized = normalizeMerchant(merchant);
  const keyword = normalized.split(" ")[0];
  return keyword && keyword.length >= 3 ? keyword : null;
}

/** Score and rank transaction candidates against a receipt. Returns best match ID or null. */
export function scoreCandidates(
  candidates: Array<{ id: string; amount: number; date: string }>,
  receiptAmount: number,
  receiptDate: string | null
): string | null {
  const scored = candidates
    .map((tx) => ({
      id: tx.id,
      amountDiff: Math.abs(Math.abs(Number(tx.amount)) - receiptAmount),
      dateDiff: receiptDate ? Math.abs(new Date(tx.date).getTime() - new Date(receiptDate).getTime()) : 0,
    }))
    .filter((s) => s.amountDiff <= 1.0)
    .sort((a, b) => a.amountDiff - b.amountDiff || a.dateDiff - b.dateDiff);

  return scored.length > 0 ? scored[0].id : null;
}

/**
 * Match unmatched email receipts to Plaid transactions by merchant + amount + date.
 * Returns the number of receipts that were matched.
 */
export async function matchReceiptsToTransactions(
  clerkUserId: string,
  receiptIds: string[]
): Promise<number> {
  const db = getSupabase();

  const { data: receipts } = await db
    .from("email_receipts")
    .select("id, merchant, amount, date")
    .in("id", receiptIds)
    .is("transaction_id", null);

  if (!receipts || receipts.length === 0) return 0;

  let matched = 0;

  for (const receipt of receipts) {
    if (!receipt.merchant || !receipt.amount) continue;

    const keyword = extractKeyword(receipt.merchant);
    if (!keyword) continue;

    const receiptAmount = Math.abs(Number(receipt.amount));
    const receiptDate = receipt.date;

    // Query candidate transactions: same user, merchant contains keyword, within date window
    let query = db
      .from("transactions")
      .select("id, amount, date")
      .eq("clerk_user_id", clerkUserId)
      .ilike("normalized_merchant", `%${keyword}%`);

    if (receiptDate) {
      const dateObj = new Date(receiptDate);
      const start = new Date(dateObj);
      start.setDate(start.getDate() - 5);
      const end = new Date(dateObj);
      end.setDate(end.getDate() + 5);
      query = query
        .gte("date", start.toISOString().split("T")[0])
        .lte("date", end.toISOString().split("T")[0]);
    }

    const { data: candidates } = await query;
    if (!candidates || candidates.length === 0) continue;

    const bestMatchId = scoreCandidates(candidates as Array<{ id: string; amount: number; date: string }>, receiptAmount, receiptDate);
    if (!bestMatchId) continue;

    await db
      .from("email_receipts")
      .update({ transaction_id: bestMatchId })
      .eq("id", receipt.id);

    matched++;
  }

  return matched;
}
