import { getSupabase } from "./supabase";
import { RECEIPT_MATCH } from "./config";

export function normalizeMerchant(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Extract meaningful keywords from a merchant name.
 * Returns up to 3 keywords, filtering out stop words and short tokens.
 */
export function extractKeywords(merchant: string): string[] {
  const normalized = normalizeMerchant(merchant);
  return normalized
    .split(" ")
    .filter(
      (w) => w.length >= RECEIPT_MATCH.MIN_KEYWORD_LENGTH && !RECEIPT_MATCH.STOP_WORDS.has(w)
    )
    .slice(0, 3);
}

/** Score and rank transaction candidates against a receipt. Returns best match ID or null. */
export function scoreCandidates(
  candidates: Array<{ id: string; amount: number; date: string }>,
  receiptAmount: number,
  receiptDate: string | null
): string | null {
  const scored = candidates
    .map((tx) => {
      const txAmount = Math.abs(Number(tx.amount));
      const amountDiff = Math.abs(txAmount - receiptAmount);
      return {
        id: tx.id,
        amountDiff,
        dateDiff: receiptDate
          ? Math.abs(new Date(tx.date).getTime() - new Date(receiptDate).getTime())
          : 0,
      };
    })
    .filter((s) => {
      if (s.amountDiff <= RECEIPT_MATCH.AMOUNT_TOLERANCE_DOLLARS) return true;
      if (receiptAmount > 0 && s.amountDiff / receiptAmount <= RECEIPT_MATCH.AMOUNT_TOLERANCE_PERCENT) return true;
      return false;
    })
    .sort((a, b) => a.amountDiff - b.amountDiff || a.dateDiff - b.dateDiff);

  return scored.length > 0 ? scored[0].id : null;
}

/**
 * Match unmatched email receipts to Plaid transactions by merchant + amount + date.
 * Uses multiple keywords for merchant matching and wider tolerances.
 * Falls back to amount+date matching if keyword matching fails.
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
  const windowDays = RECEIPT_MATCH.DATE_WINDOW_DAYS;

  for (const receipt of receipts) {
    if (!receipt.merchant || !receipt.amount) continue;

    const receiptAmount = Math.abs(Number(receipt.amount));
    const receiptDate = receipt.date;

    // Build date window
    let dateStart: string | undefined;
    let dateEnd: string | undefined;
    if (receiptDate) {
      const dateObj = new Date(receiptDate);
      const start = new Date(dateObj);
      start.setDate(start.getDate() - windowDays);
      const end = new Date(dateObj);
      end.setDate(end.getDate() + windowDays);
      dateStart = start.toISOString().split("T")[0];
      dateEnd = end.toISOString().split("T")[0];
    }

    // Strategy 1: keyword-based merchant matching
    const keywords = extractKeywords(receipt.merchant);
    let bestMatchId: string | null = null;

    if (keywords.length > 0) {
      for (const keyword of keywords) {
        let query = db
          .from("transactions")
          .select("id, amount, date")
          .eq("clerk_user_id", clerkUserId)
          .ilike("normalized_merchant", `%${keyword}%`);

        if (dateStart && dateEnd) {
          query = query.gte("date", dateStart).lte("date", dateEnd);
        }

        const { data: candidates } = await query;
        if (candidates && candidates.length > 0) {
          bestMatchId = scoreCandidates(
            candidates as Array<{ id: string; amount: number; date: string }>,
            receiptAmount,
            receiptDate
          );
          if (bestMatchId) break;
        }
      }
    }

    // Strategy 2: fallback — match by amount + date alone (tighter tolerance)
    if (!bestMatchId && dateStart && dateEnd) {
      const { data: fallbackCandidates } = await db
        .from("transactions")
        .select("id, amount, date")
        .eq("clerk_user_id", clerkUserId)
        .gte("date", dateStart)
        .lte("date", dateEnd);

      if (fallbackCandidates && fallbackCandidates.length > 0) {
        const tight = fallbackCandidates
          .map((tx) => ({
            id: tx.id as string,
            amountDiff: Math.abs(Math.abs(Number(tx.amount)) - receiptAmount),
            dateDiff: receiptDate
              ? Math.abs(new Date(tx.date as string).getTime() - new Date(receiptDate).getTime())
              : 0,
          }))
          .filter((s) => s.amountDiff <= 1.0)
          .sort((a, b) => a.amountDiff - b.amountDiff || a.dateDiff - b.dateDiff);

        if (tight.length > 0) {
          bestMatchId = tight[0].id;
        }
      }
    }

    if (!bestMatchId) continue;

    await db
      .from("email_receipts")
      .update({ transaction_id: bestMatchId })
      .eq("id", receipt.id);

    matched++;
  }

  return matched;
}
