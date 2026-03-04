import { getSupabase } from "./supabase";

function normalizeMerchant(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
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
    .select("id, merchant, total_amount, order_date")
    .in("id", receiptIds)
    .is("transaction_id", null);

  if (!receipts || receipts.length === 0) return 0;

  let matched = 0;

  for (const receipt of receipts) {
    if (!receipt.merchant || !receipt.total_amount) continue;

    const normalizedMerchant = normalizeMerchant(receipt.merchant);
    // Extract the core merchant keyword (e.g., "amazon" from "Amazon.com")
    const keyword = normalizedMerchant.split(" ")[0];
    if (!keyword || keyword.length < 3) continue;

    const receiptAmount = Math.abs(Number(receipt.total_amount));
    const receiptDate = receipt.order_date;

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

    // Find best match by amount (within $1 tolerance), then closest date
    const scored = candidates
      .map((tx) => ({
        id: tx.id,
        amountDiff: Math.abs(Math.abs(Number(tx.amount)) - receiptAmount),
        dateDiff: receiptDate ? Math.abs(new Date(tx.date).getTime() - new Date(receiptDate).getTime()) : 0,
      }))
      .filter((s) => s.amountDiff <= 1.0)
      .sort((a, b) => a.amountDiff - b.amountDiff || a.dateDiff - b.dateDiff);

    if (scored.length === 0) continue;

    await db
      .from("email_receipts")
      .update({ transaction_id: scored[0].id })
      .eq("id", receipt.id);

    matched++;
  }

  return matched;
}
