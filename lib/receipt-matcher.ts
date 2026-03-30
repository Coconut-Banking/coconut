import { getSupabase } from "./supabase";
import { RECEIPT_MATCH } from "./config";

export function normalizeMerchant(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Extract meaningful keywords from a merchant name.
 * Returns up to 3 keywords, filtering out stop words and short tokens.
 */
/** Escape PostgREST special characters for safe use in ilike patterns. */
function sanitizeForIlike(s: string): string {
  return s.replace(/[%_\\]/g, "");
}

export function extractKeywords(merchant: string): string[] {
  const normalized = normalizeMerchant(merchant);
  return normalized
    .split(" ")
    .filter(
      (w) => w.length >= RECEIPT_MATCH.MIN_KEYWORD_LENGTH && !RECEIPT_MATCH.STOP_WORDS.has(w)
    )
    .map(sanitizeForIlike)
    .filter((w) => w.length > 0)
    .slice(0, 3);
}

/** Check if two merchant names are similar enough to be the same merchant. */
function merchantsMatch(receiptMerchant: string, txMerchant: string): boolean {
  const a = normalizeMerchant(receiptMerchant);
  const b = normalizeMerchant(txMerchant);
  if (!a || !b) return false;

  // Direct substring match (either direction)
  if (a.includes(b) || b.includes(a)) return true;

  // Keyword overlap: at least one keyword from receipt appears in transaction merchant
  const keywords = a.split(" ").filter((w) => w.length >= 3);
  if (keywords.some((kw) => b.includes(kw))) return true;

  return false;
}

/** Score and rank transaction candidates against a receipt. Returns best match ID or null. */
export function scoreCandidates(
  candidates: Array<{ id: string; amount: number; date: string; normalized_merchant?: string }>,
  receiptAmount: number,
  receiptDate: string | null,
  receiptMerchant?: string
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
        normalized_merchant: tx.normalized_merchant,
      };
    })
    .filter((s) => {
      // Amount must be close enough
      const amountOk =
        s.amountDiff <= RECEIPT_MATCH.AMOUNT_TOLERANCE_DOLLARS ||
        (receiptAmount > 0 && s.amountDiff / receiptAmount <= RECEIPT_MATCH.AMOUNT_TOLERANCE_PERCENT);
      if (!amountOk) return false;

      // If we have merchant info, validate it matches
      if (receiptMerchant && s.normalized_merchant) {
        if (!merchantsMatch(receiptMerchant, s.normalized_merchant)) return false;
      }

      return true;
    })
    .sort((a, b) => a.amountDiff - b.amountDiff || a.dateDiff - b.dateDiff);

  return scored.length > 0 ? scored[0].id : null;
}

/**
 * Match unmatched email receipts to Plaid transactions by merchant + amount + date.
 * Uses multiple keywords for merchant matching and wider tolerances.
 * Falls back to amount+date matching WITH merchant validation if keyword matching fails.
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
          .select("id, amount, date, normalized_merchant")
          .eq("clerk_user_id", clerkUserId)
          .ilike("normalized_merchant", `%${keyword}%`);

        if (dateStart && dateEnd) {
          query = query.gte("date", dateStart).lte("date", dateEnd);
        }

        const { data: candidates } = await query;
        if (candidates && candidates.length > 0) {
          bestMatchId = scoreCandidates(
            candidates as Array<{ id: string; amount: number; date: string; normalized_merchant?: string }>,
            receiptAmount,
            receiptDate,
            receipt.merchant
          );
          if (bestMatchId) break;
        }
      }
    }

    // Strategy 2: fallback — amount + date + merchant name validation
    // Previously this matched on amount+date alone, causing wrong matches
    // (e.g. Target receipt → Zelle payment with same amount).
    // Now requires merchant name similarity.
    if (!bestMatchId && dateStart && dateEnd) {
      const { data: fallbackCandidates } = await db
        .from("transactions")
        .select("id, amount, date, normalized_merchant")
        .eq("clerk_user_id", clerkUserId)
        .gte("date", dateStart)
        .lte("date", dateEnd);

      if (fallbackCandidates && fallbackCandidates.length > 0) {
        const tight = fallbackCandidates
          .filter((tx) => {
            if (tx.date == null) return false;
            // Must have merchant similarity
            const txMerchant = (tx.normalized_merchant as string) || "";
            return merchantsMatch(receipt.merchant, txMerchant);
          })
          .map((tx) => {
            const txDate = new Date(tx.date as string);
            const dateDiff = receiptDate && !isNaN(txDate.getTime())
              ? Math.abs(txDate.getTime() - new Date(receiptDate).getTime())
              : Number.MAX_SAFE_INTEGER;
            return {
              id: tx.id as string,
              amountDiff: Math.abs(Math.abs(Number(tx.amount)) - receiptAmount),
              dateDiff,
            };
          })
          .filter((s) => s.amountDiff <= 1.0 && isFinite(s.dateDiff))
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

/**
 * Re-match all unmatched receipts and audit existing matches.
 * Clears wrong matches (where merchant names don't align) and
 * re-runs matching for all unmatched receipts against full transaction history.
 */
export async function auditAndRematchAllReceipts(
  clerkUserId: string
): Promise<{ cleared: number; rematched: number }> {
  const db = getSupabase();

  // Step 1: Audit existing matches — clear ones where merchant names don't align
  const { data: matchedReceipts } = await db
    .from("email_receipts")
    .select("id, merchant, amount, transaction_id")
    .eq("clerk_user_id", clerkUserId)
    .not("transaction_id", "is", null);

  let cleared = 0;
  if (matchedReceipts && matchedReceipts.length > 0) {
    const txIds = matchedReceipts.map((r) => r.transaction_id).filter(Boolean) as string[];
    const { data: txRows } = await db
      .from("transactions")
      .select("id, normalized_merchant, merchant_name")
      .in("id", txIds);

    const txMap = new Map((txRows ?? []).map((t) => [t.id as string, t]));

    for (const receipt of matchedReceipts) {
      const tx = txMap.get(receipt.transaction_id as string);
      if (!tx) continue;
      const txMerchant = (tx.normalized_merchant as string) || (tx.merchant_name as string) || "";
      if (!merchantsMatch(receipt.merchant, txMerchant)) {
        await db
          .from("email_receipts")
          .update({ transaction_id: null })
          .eq("id", receipt.id);
        cleared++;
      }
    }
  }

  // Step 2: Re-match all unmatched receipts
  const { data: unmatched } = await db
    .from("email_receipts")
    .select("id")
    .eq("clerk_user_id", clerkUserId)
    .is("transaction_id", null);

  let rematched = 0;
  if (unmatched && unmatched.length > 0) {
    rematched = await matchReceiptsToTransactions(
      clerkUserId,
      unmatched.map((r) => r.id)
    );
  }

  return { cleared, rematched };
}
