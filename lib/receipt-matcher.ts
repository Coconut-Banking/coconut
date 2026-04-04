import { getSupabase } from "./supabase";
import { RECEIPT_MATCH } from "./config";

export function normalizeMerchant(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

function sanitizeForIlike(s: string): string {
  return s.replace(/[%_\\]/g, "");
}

const MERCHANT_ALIASES: Record<string, string[]> = {
  lyft: ["lyft", "lyft ride", "lyft scooter"],
  uber: ["uber", "uber trip", "uber eats", "uber one"],
  doordash: ["doordash", "dd doordash"],
  grubhub: ["grubhub", "seamless"],
  target: ["target", "target com"],
  amazon: ["amazon", "amzn", "amazon com", "amazon prime", "amzn mktp"],
  walmart: ["walmart", "wal mart", "wm supercenter"],
  costco: ["costco", "costco whse"],
  airbnb: ["airbnb", "air bnb"],
  starbucks: ["starbucks", "sbux"],
  mcdonalds: ["mcdonalds", "mcdonald"],
  apple: ["apple", "apple com bill", "apple com"],
  spotify: ["spotify"],
  netflix: ["netflix"],
  instacart: ["instacart"],
  gopuff: ["gopuff", "go puff"],
  chevron: ["chevron"],
  shell: ["shell oil", "shell service"],
  clipper: ["clipper", "clipper card", "bay area toll"],
  frontier: ["frontier", "frontier airlines"],
  wise: ["wise", "transferwise"],
};

function resolveAliases(merchant: string): string[] {
  const norm = normalizeMerchant(merchant);
  const extra: string[] = [];
  for (const [canonical, aliases] of Object.entries(MERCHANT_ALIASES)) {
    if (aliases.some((a) => norm.includes(a)) || norm.includes(canonical)) {
      extra.push(canonical);
      for (const a of aliases) {
        const kw = a.split(" ")[0];
        if (kw.length >= 3 && !extra.includes(kw)) extra.push(kw);
      }
    }
  }
  return extra;
}

export function extractKeywords(merchant: string): string[] {
  const normalized = normalizeMerchant(merchant);
  const words = normalized
    .split(" ")
    .filter(
      (w) => w.length >= RECEIPT_MATCH.MIN_KEYWORD_LENGTH && !RECEIPT_MATCH.STOP_WORDS.has(w)
    )
    .map(sanitizeForIlike)
    .filter((w) => w.length > 0);

  const aliasKeywords = resolveAliases(merchant)
    .map(sanitizeForIlike)
    .filter((w) => w.length > 0);

  const seen = new Set<string>();
  const result: string[] = [];
  for (const w of [...words, ...aliasKeywords]) {
    if (!seen.has(w)) {
      seen.add(w);
      result.push(w);
    }
  }
  return result.slice(0, 5);
}

export function merchantsMatch(receiptMerchant: string, txMerchant: string): boolean {
  const a = normalizeMerchant(receiptMerchant);
  const b = normalizeMerchant(txMerchant);
  if (!a || !b) return false;

  if (a.includes(b) || b.includes(a)) return true;

  const aKeywords = a.split(" ").filter((w) => w.length >= 3);
  if (aKeywords.some((kw) => b.includes(kw))) return true;

  const bKeywords = b.split(" ").filter((w) => w.length >= 3);
  if (bKeywords.some((kw) => a.includes(kw))) return true;

  const aAliases = resolveAliases(receiptMerchant);
  const bAliases = resolveAliases(txMerchant);
  if (aAliases.length > 0 && bAliases.length > 0) {
    if (aAliases.some((aa) => bAliases.includes(aa))) return true;
  }
  if (aAliases.some((aa) => b.includes(aa))) return true;
  if (bAliases.some((ba) => a.includes(ba))) return true;

  return false;
}

function amountWithinTolerance(receiptAmount: number, txAmount: number): boolean {
  const diff = Math.abs(txAmount - receiptAmount);
  return (
    diff <= RECEIPT_MATCH.AMOUNT_TOLERANCE_DOLLARS ||
    (receiptAmount > 0 && diff / receiptAmount <= RECEIPT_MATCH.AMOUNT_TOLERANCE_PERCENT)
  );
}

export function scoreCandidates(
  candidates: Array<{ id: string; amount: number; date: string; normalized_merchant?: string; merchant_name?: string }>,
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
        merchant_name: tx.merchant_name,
      };
    })
    .filter((s) => {
      if (!amountWithinTolerance(receiptAmount, receiptAmount + s.amountDiff)) return false;

      if (receiptMerchant) {
        const txMerch = s.normalized_merchant || s.merchant_name || "";
        if (txMerch && !merchantsMatch(receiptMerchant, txMerch)) return false;
      }

      return true;
    })
    .sort((a, b) => a.amountDiff - b.amountDiff || a.dateDiff - b.dateDiff);

  return scored.length > 0 ? scored[0].id : null;
}

/**
 * Match unmatched email receipts to Plaid transactions.
 *
 * Strategy 1: keyword ilike on normalized_merchant (+ merchant_name fallback)
 * Strategy 2: date-window scan with merchant name validation + full amount tolerance
 * Strategy 3: date-window scan, amount-only with very tight tolerance ($0.50)
 *             when merchant can't be validated (covers merchants with very
 *             different names in email vs bank, e.g. "Mensho Tokyo SF" vs "SQ *MENSHO")
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

  const { data: alreadyLinked } = await db
    .from("email_receipts")
    .select("transaction_id")
    .eq("clerk_user_id", clerkUserId)
    .not("transaction_id", "is", null);
  const alreadyMatchedTxIds = new Set(
    (alreadyLinked ?? []).map((r) => r.transaction_id as string).filter(Boolean)
  );

  let matched = 0;
  const windowDays = RECEIPT_MATCH.DATE_WINDOW_DAYS;

  for (const receipt of receipts) {
    if (!receipt.merchant || !receipt.amount) continue;

    const receiptAmount = Math.abs(Number(receipt.amount));
    const receiptDate = receipt.date;

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

    // ── Strategy 1: keyword ilike on normalized_merchant + merchant_name ──
    const keywords = extractKeywords(receipt.merchant);
    let bestMatchId: string | null = null;

    if (keywords.length > 0) {
      for (const keyword of keywords) {
        // Try normalized_merchant first
        for (const col of ["normalized_merchant", "merchant_name"] as const) {
          let query = db
            .from("transactions")
            .select("id, amount, date, normalized_merchant, merchant_name")
            .eq("clerk_user_id", clerkUserId)
            .ilike(col, `%${keyword}%`);

          if (dateStart && dateEnd) {
            query = query.gte("date", dateStart).lte("date", dateEnd);
          }

          const { data: candidates } = await query;
          if (candidates && candidates.length > 0) {
            const available = (candidates as Array<{ id: string; amount: number; date: string; normalized_merchant?: string; merchant_name?: string }>)
              .filter((tx) => !alreadyMatchedTxIds.has(tx.id));
            bestMatchId = scoreCandidates(
              available,
              receiptAmount,
              receiptDate,
              receipt.merchant
            );
            if (bestMatchId) break;
          }
        }
        if (bestMatchId) break;
      }
    }

    // ── Strategy 2: date-window scan + merchant validation + full tolerance ──
    if (!bestMatchId && dateStart && dateEnd) {
      const { data: fallbackCandidates } = await db
        .from("transactions")
        .select("id, amount, date, normalized_merchant, merchant_name")
        .eq("clerk_user_id", clerkUserId)
        .gte("date", dateStart)
        .lte("date", dateEnd);

      if (fallbackCandidates && fallbackCandidates.length > 0) {
        const scored = fallbackCandidates
          .filter((tx) => {
            if (tx.date == null) return false;
            if (alreadyMatchedTxIds.has(tx.id as string)) return false;
            const txMerchant = (tx.normalized_merchant as string) || (tx.merchant_name as string) || "";
            return merchantsMatch(receipt.merchant, txMerchant);
          })
          .map((tx) => {
            const txAmount = Math.abs(Number(tx.amount));
            const txDate = new Date(tx.date as string);
            const dateDiff = receiptDate && !isNaN(txDate.getTime())
              ? Math.abs(txDate.getTime() - new Date(receiptDate).getTime())
              : Number.MAX_SAFE_INTEGER;
            return {
              id: tx.id as string,
              amountDiff: Math.abs(txAmount - receiptAmount),
              dateDiff,
              txAmount,
            };
          })
          .filter((s) => amountWithinTolerance(receiptAmount, receiptAmount + s.amountDiff) && isFinite(s.dateDiff))
          .sort((a, b) => a.amountDiff - b.amountDiff || a.dateDiff - b.dateDiff);

        if (scored.length > 0) {
          bestMatchId = scored[0].id;
        }
      }
    }

    // ── Strategy 3: tight amount match without merchant validation ──
    // Only within 3 days and $0.50 — high confidence the amounts are the same charge.
    if (!bestMatchId && receiptDate) {
      const tightDateObj = new Date(receiptDate);
      const tightStart = new Date(tightDateObj);
      tightStart.setDate(tightStart.getDate() - 3);
      const tightEnd = new Date(tightDateObj);
      tightEnd.setDate(tightEnd.getDate() + 3);

      const { data: tightCandidates } = await db
        .from("transactions")
        .select("id, amount, date, normalized_merchant, merchant_name")
        .eq("clerk_user_id", clerkUserId)
        .gte("date", tightStart.toISOString().split("T")[0])
        .lte("date", tightEnd.toISOString().split("T")[0]);

      if (tightCandidates && tightCandidates.length > 0) {
        const scored = tightCandidates
          .filter((tx) => {
            if (alreadyMatchedTxIds.has(tx.id as string)) return false;
            return true;
          })
          .map((tx) => {
            const txAmount = Math.abs(Number(tx.amount));
            return {
              id: tx.id as string,
              amountDiff: Math.abs(txAmount - receiptAmount),
              dateDiff: Math.abs(new Date(tx.date as string).getTime() - new Date(receiptDate).getTime()),
            };
          })
          .filter((s) => s.amountDiff <= 0.50)
          .sort((a, b) => a.amountDiff - b.amountDiff || a.dateDiff - b.dateDiff);

        if (scored.length > 0) {
          bestMatchId = scored[0].id;
        }
      }
    }

    if (!bestMatchId) continue;

    await db
      .from("email_receipts")
      .update({ transaction_id: bestMatchId })
      .eq("id", receipt.id);

    alreadyMatchedTxIds.add(bestMatchId);
    matched++;
  }

  return matched;
}

/**
 * Clear invalid receipt matches: deleted transactions OR cross-user matches
 * (receipt matched to a transaction belonging to a different user).
 * Returns the number of bad matches cleared.
 */
export async function clearStaleReceiptMatches(clerkUserId: string): Promise<number> {
  const db = getSupabase();

  const { data: matchedReceipts } = await db
    .from("email_receipts")
    .select("id, transaction_id")
    .eq("clerk_user_id", clerkUserId)
    .not("transaction_id", "is", null);

  if (!matchedReceipts || matchedReceipts.length === 0) return 0;

  const txIds = matchedReceipts.map((r) => r.transaction_id).filter(Boolean) as string[];
  // Only accept transactions that exist AND belong to this user
  const { data: txRows } = await db
    .from("transactions")
    .select("id")
    .in("id", txIds)
    .eq("clerk_user_id", clerkUserId);

  const validTxIds = new Set((txRows ?? []).map((t) => t.id as string));
  let cleared = 0;

  for (const receipt of matchedReceipts) {
    if (!validTxIds.has(receipt.transaction_id as string)) {
      await db
        .from("email_receipts")
        .update({ transaction_id: null })
        .eq("id", receipt.id);
      cleared++;
    }
  }

  return cleared;
}

/**
 * Re-match all unmatched receipts and audit existing matches.
 * Clears wrong matches (stale FKs or merchant name mismatch) and
 * re-runs matching for all unmatched receipts against full transaction history.
 */
export async function auditAndRematchAllReceipts(
  clerkUserId: string
): Promise<{ cleared: number; matched: number }> {
  const db = getSupabase();

  // Step 1a: Clear stale matches (transaction was deleted/deduped)
  let cleared = await clearStaleReceiptMatches(clerkUserId);

  // Step 1b: Clear matches where merchant names don't align
  const { data: matchedReceipts } = await db
    .from("email_receipts")
    .select("id, merchant, amount, transaction_id")
    .eq("clerk_user_id", clerkUserId)
    .not("transaction_id", "is", null);

  if (matchedReceipts && matchedReceipts.length > 0) {
    const txIds = matchedReceipts.map((r) => r.transaction_id).filter(Boolean) as string[];
    const { data: txRows } = await db
      .from("transactions")
      .select("id, normalized_merchant, merchant_name, amount")
      .in("id", txIds);

    const txMap = new Map((txRows ?? []).map((t) => [t.id as string, t]));

    for (const receipt of matchedReceipts) {
      const tx = txMap.get(receipt.transaction_id as string);
      if (!tx) continue;
      const txMerchant = (tx.normalized_merchant as string) || (tx.merchant_name as string) || "";
      const txAmount = Math.abs(Number(tx.amount));
      const rcptAmount = Math.abs(Number(receipt.amount));
      // Keep the match if merchant names align, OR if the amount is very close
      // (within $0.50) — covers cases where bank and email use very different names
      const nameOk = merchantsMatch(receipt.merchant, txMerchant);
      const tightAmountOk = Math.abs(txAmount - rcptAmount) <= 0.50;
      if (!nameOk && !tightAmountOk) {
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

  let matched = 0;
  if (unmatched && unmatched.length > 0) {
    matched = await matchReceiptsToTransactions(
      clerkUserId,
      unmatched.map((r) => r.id)
    );
  }

  return { cleared, matched };
}
