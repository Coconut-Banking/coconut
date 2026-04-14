import { getSupabase } from "./supabase";
import { RECEIPT_MATCH } from "./config";

// POS processor prefixes that appear in Plaid transaction names but not email receipts.
// Strip these before matching so "SQ *MENSHO" matches "Mensho Tokyo SF".
const POS_PREFIX_RE = /^(sq\s*\*|tst\*|tst\s+|sp\s*\*|pp\s*\*|pp\s+|amzn\s*\*|paypal\s*\*|paypal\s+|checkcard\s+|pos\s+|purchase\s+|ach\s+|dda\s+|applecard\s+gs\s+bank|google\s*\*)\s*/i;

export function normalizeMerchant(s: string): string {
  return s
    .replace(POS_PREFIX_RE, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
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
  mcdonalds: ["mcdonalds", "mcdonald", "mcd"],
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
  chipotle: ["chipotle", "chipotle mexican"],
  traderjoes: ["trader joes", "trader joe"],
  wholefoods: ["whole foods", "wholefoods", "wfm"],
  sephora: ["sephora"],
  nike: ["nike"],
  homedepot: ["home depot", "the home depot"],
  lowes: ["lowes", "lowe s"],
  bestbuy: ["best buy", "bestbuy"],
  chewy: ["chewy"],
  etsy: ["etsy"],
  deltaairlines: ["delta", "delta air", "delta airlines"],
  unitedairlines: ["united", "united airlines", "united air"],
  southwest: ["southwest", "southwest airlines"],
  hulu: ["hulu"],
  disney: ["disney", "disney plus", "disneyplus"],
  github: ["github"],
  openai: ["openai", "openai chatgpt"],
};

/**
 * Returns the canonical alias group key(s) that merchant belongs to.
 * Used ONLY for group-membership checks (same group = same merchant).
 * Intentionally excludes sub-tokens to prevent cross-group collisions
 * (e.g. "airlines" appearing in both Delta and United).
 */
function resolveAliasGroups(merchant: string): string[] {
  const norm = normalizeMerchant(merchant);
  const groups: string[] = [];
  for (const [canonical, aliases] of Object.entries(MERCHANT_ALIASES)) {
    if (aliases.some((a) => norm.includes(a)) || norm.includes(canonical)) {
      groups.push(canonical);
    }
  }
  return groups;
}

/**
 * Returns all alias tokens (canonical key + sub-tokens from alias strings)
 * for a merchant. Used for keyword extraction and word-boundary matching.
 * Stop words are filtered to avoid generic tokens (e.g. "airlines") causing
 * cross-group false positives.
 */
function resolveAliasKeywords(merchant: string): string[] {
  const norm = normalizeMerchant(merchant);
  const extra: string[] = [];
  for (const [canonical, aliases] of Object.entries(MERCHANT_ALIASES)) {
    if (aliases.some((a) => norm.includes(a)) || norm.includes(canonical)) {
      if (!extra.includes(canonical)) extra.push(canonical);
      for (const a of aliases) {
        for (const kw of a.split(" ").filter(
          (t) => t.length >= 3 && !RECEIPT_MATCH.STOP_WORDS.has(t)
        )) {
          if (!extra.includes(kw)) extra.push(kw);
        }
      }
    }
  }
  return extra;
}

/** @deprecated Use resolveAliasGroups or resolveAliasKeywords */
function resolveAliases(merchant: string): string[] {
  return resolveAliasKeywords(merchant);
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

  const aliasKeywords = resolveAliasKeywords(merchant)
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
  return result.slice(0, RECEIPT_MATCH.MAX_KEYWORDS);
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

  // Group check: same canonical alias group = same merchant
  const aGroups = resolveAliasGroups(receiptMerchant);
  const bGroups = resolveAliasGroups(txMerchant);
  if (aGroups.length > 0 && bGroups.length > 0) {
    if (aGroups.some((g) => bGroups.includes(g))) return true;
  }

  // Keyword check: alias tokens from one side appear as whole words in the other's
  // normalized name. Use word-token matching (not substring) to prevent e.g.
  // "delta" alias token "air" matching inside "united airlines".
  const aWords = new Set(a.split(" "));
  const bWords = new Set(b.split(" "));
  const aKeywordAliases = resolveAliasKeywords(receiptMerchant);
  const bKeywordAliases = resolveAliasKeywords(txMerchant);
  if (aKeywordAliases.some((kw) => bWords.has(kw))) return true;
  if (bKeywordAliases.some((kw) => aWords.has(kw))) return true;

  return false;
}

/**
 * When merchantMatched=true (Strategies 1 & 2), allow up to ±$5 or ±10% of
 * the receipt amount, whichever is smaller. This covers tips, rounding, and
 * tax discrepancies while avoiding false positives on large amounts.
 * When merchantMatched=false (Strategy 3 — no merchant validation), require
 * exact match ($0.01) to compensate for the lack of merchant signal.
 */
function amountWithinTolerance(
  receiptAmount: number,
  txAmount: number,
  merchantMatched = false
): boolean {
  const diff = Math.abs(txAmount - receiptAmount);
  if (merchantMatched) {
    const tolerance = Math.min(
      RECEIPT_MATCH.AMOUNT_TOLERANCE_DOLLARS,
      receiptAmount * RECEIPT_MATCH.AMOUNT_TOLERANCE_PERCENT
    );
    return diff <= Math.max(tolerance, RECEIPT_MATCH.AMOUNT_TOLERANCE_EXACT);
  }
  return diff <= RECEIPT_MATCH.AMOUNT_TOLERANCE_EXACT;
}

/**
 * Returns true when both merchant strings resolve to known-distinct alias groups.
 * Used to reject Strategy 3 amount-only matches where the merchants are clearly
 * different entities (e.g. "Airbnb" vs "Clipper Transit Fare").
 */
function knownMerchantsConflict(m1: string, m2: string): boolean {
  if (!m1 || !m2) return false;
  const g1 = resolveAliasGroups(m1);
  const g2 = resolveAliasGroups(m2);
  // Both are recognised merchants and share no canonical group → definitively different
  return g1.length > 0 && g2.length > 0 && !g1.some((g) => g2.includes(g));
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
      const txMerch = tx.normalized_merchant || tx.merchant_name || "";
      // merchantMatched=true only when there is a real merchant signal on both sides.
      // Missing merchant name → false (tight tolerance), not true (loose tolerance).
      const merchantMatched = Boolean(
        receiptMerchant && txMerch && merchantsMatch(receiptMerchant, txMerch)
      );
      return {
        id: tx.id,
        txAmount,
        amountDiff: Math.abs(txAmount - receiptAmount),
        dateDiff: receiptDate
          ? Math.abs(new Date(tx.date).getTime() - new Date(receiptDate).getTime())
          : 0,
        normalized_merchant: tx.normalized_merchant,
        merchant_name: tx.merchant_name,
        merchantMatched,
      };
    })
    .filter((s) => {
      // Reject if amount is outside tolerance (tiered by merchant match confidence)
      if (!amountWithinTolerance(receiptAmount, s.txAmount, s.merchantMatched)) return false;
      // Reject if a receipt merchant was provided but this tx doesn't match
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
 * Batched O(1) approach — fetches ALL candidate transactions in one query
 * covering the full date range of all receipts, then performs all matching
 * logic in-memory. Reduces from O(N) DB queries to O(1).
 *
 * Strategy 1: keyword match on normalized_merchant (+ merchant_name fallback)
 * Strategy 2: date-window scan with merchant name validation + full amount tolerance
 * Strategy 3: date-window scan, amount-only with very tight tolerance ($0.01)
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

  // Asymmetric window: receipt date is the order date; bank transactions typically
  // post 1-3 days later. Look back a few days (pre-auth/same-day charges) and
  // forward more days (delayed posting, pending → posted transitions).
  const WINDOW_BEFORE_DAYS = RECEIPT_MATCH.WINDOW_BEFORE_DAYS;
  const WINDOW_AFTER_DAYS = RECEIPT_MATCH.WINDOW_AFTER_DAYS;

  // Collect the overall date range covering ALL receipts
  let globalMinDate: Date | null = null;
  let globalMaxDate: Date | null = null;
  for (const receipt of receipts) {
    if (!receipt.date) continue;
    const d = new Date(receipt.date);
    const lo = new Date(d); lo.setDate(lo.getDate() - WINDOW_BEFORE_DAYS);
    const hi = new Date(d); hi.setDate(hi.getDate() + WINDOW_AFTER_DAYS);
    if (!globalMinDate || lo < globalMinDate) globalMinDate = lo;
    if (!globalMaxDate || hi > globalMaxDate) globalMaxDate = hi;
  }

  // ONE query to fetch all candidate transactions in the full date range
  type TxCandidate = { id: string; amount: number; date: string; normalized_merchant: string | null; merchant_name: string | null };
  let allCandidates: TxCandidate[] = [];
  if (globalMinDate && globalMaxDate) {
    const { data: txRows } = await db
      .from("transactions")
      .select("id, amount, date, normalized_merchant, merchant_name")
      .eq("clerk_user_id", clerkUserId)
      .gte("date", globalMinDate.toISOString().split("T")[0])
      .lte("date", globalMaxDate.toISOString().split("T")[0]);
    allCandidates = (txRows ?? []) as TxCandidate[];
  }

  let matched = 0;

  for (const receipt of receipts) {
    if (!receipt.merchant || !receipt.amount) continue;

    const receiptAmount = Math.abs(Number(receipt.amount));
    const receiptDate = receipt.date;

    // Compute per-receipt date window for filtering in-memory
    let dateStart: string | undefined;
    let dateEnd: string | undefined;
    let tightStart: string | undefined;
    let tightEnd: string | undefined;
    if (receiptDate) {
      const dateObj = new Date(receiptDate);
      const start = new Date(dateObj); start.setDate(start.getDate() - WINDOW_BEFORE_DAYS);
      const end = new Date(dateObj); end.setDate(end.getDate() + WINDOW_AFTER_DAYS);
      dateStart = start.toISOString().split("T")[0];
      dateEnd = end.toISOString().split("T")[0];

      // Tight window for Strategy 3: same asymmetry but narrower
      const ts = new Date(dateObj); ts.setDate(ts.getDate() - RECEIPT_MATCH.TIGHT_WINDOW_BEFORE_DAYS);
      const te = new Date(dateObj); te.setDate(te.getDate() + RECEIPT_MATCH.TIGHT_WINDOW_AFTER_DAYS);
      tightStart = ts.toISOString().split("T")[0];
      tightEnd = te.toISOString().split("T")[0];
    }

    // Filter in-memory candidates within this receipt's date window
    const windowCandidates = allCandidates.filter((tx) => {
      if (alreadyMatchedTxIds.has(tx.id)) return false;
      if (!dateStart || !dateEnd) return true;
      return tx.date >= dateStart && tx.date <= dateEnd;
    });

    const keywords = extractKeywords(receipt.merchant);
    let bestMatchId: string | null = null;

    // ── Strategy 1: keyword match in-memory ──
    if (keywords.length > 0) {
      for (const keyword of keywords) {
        const kwLower = keyword.toLowerCase();
        const keywordMatches = windowCandidates.filter((tx) => {
          const nm = (tx.normalized_merchant ?? "").toLowerCase();
          const mn = (tx.merchant_name ?? "").toLowerCase();
          return nm.includes(kwLower) || mn.includes(kwLower);
        });
        if (keywordMatches.length > 0) {
          bestMatchId = scoreCandidates(
            keywordMatches as Array<{ id: string; amount: number; date: string; normalized_merchant?: string; merchant_name?: string }>,
            receiptAmount,
            receiptDate,
            receipt.merchant
          );
          if (bestMatchId) break;
        }
      }
    }

    // ── Strategy 2: date-window scan + merchant validation ──
    if (!bestMatchId && dateStart && dateEnd) {
      const scored = windowCandidates
        .filter((tx) => {
          if (tx.date == null) return false;
          const txMerchant = tx.normalized_merchant || tx.merchant_name || "";
          return merchantsMatch(receipt.merchant, txMerchant);
        })
        .map((tx) => {
          const txAmount = Math.abs(Number(tx.amount));
          const txDate = new Date(tx.date);
          const dateDiff = receiptDate && !isNaN(txDate.getTime())
            ? Math.abs(txDate.getTime() - new Date(receiptDate).getTime())
            : Number.MAX_SAFE_INTEGER;
          return {
            id: tx.id,
            amountDiff: Math.abs(txAmount - receiptAmount),
            dateDiff,
            txAmount,
          };
        })
        .filter((s) => amountWithinTolerance(receiptAmount, receiptAmount + s.amountDiff, true) && isFinite(s.dateDiff))
        .sort((a, b) => a.amountDiff - b.amountDiff || a.dateDiff - b.dateDiff);

      if (scored.length > 0) {
        bestMatchId = scored[0].id;
      }
    }

    // ── Strategy 3: tight amount match without merchant validation ──
    if (!bestMatchId && receiptDate && tightStart && tightEnd) {
      const tightCandidates = allCandidates.filter((tx) => {
        if (alreadyMatchedTxIds.has(tx.id)) return false;
        return tx.date >= tightStart! && tx.date <= tightEnd!;
      });

      const scored = tightCandidates
        .filter((tx) => {
          const txMerch = tx.normalized_merchant || tx.merchant_name || "";
          if (txMerch && knownMerchantsConflict(receipt.merchant, txMerch)) return false;
          return true;
        })
        .map((tx) => {
          const txAmount = Math.abs(Number(tx.amount));
          return {
            id: tx.id,
            amountDiff: Math.abs(txAmount - receiptAmount),
            dateDiff: Math.abs(new Date(tx.date).getTime() - new Date(receiptDate).getTime()),
          };
        })
        .filter((s) => amountWithinTolerance(receiptAmount, receiptAmount + s.amountDiff, false))
        .sort((a, b) => a.amountDiff - b.amountDiff || a.dateDiff - b.dateDiff);

      if (scored.length > 0) {
        bestMatchId = scored[0].id;
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

    const toClear: string[] = [];
    for (const receipt of matchedReceipts) {
      const tx = txMap.get(receipt.transaction_id as string);
      if (!tx) continue;
      const txMerchant = (tx.normalized_merchant as string) || (tx.merchant_name as string) || "";
      const txAmount = Math.abs(Number(tx.amount));
      const rcptAmount = Math.abs(Number(receipt.amount));
      // Keep the match if merchant names align, OR if the amount is very close
      // (within $0.50) — covers cases where bank and email use very different names.
      // But if merchants are known-conflicting aliases (e.g. Airbnb vs Clipper),
      // clear it regardless of how close the amounts are.
      const nameOk = merchantsMatch(receipt.merchant, txMerchant);
      const tightAmountOk = amountWithinTolerance(rcptAmount, txAmount, false);
      const aliasConflict = knownMerchantsConflict(receipt.merchant, txMerchant);
      if (!nameOk && (!tightAmountOk || aliasConflict)) {
        toClear.push(receipt.id as string);
        cleared++;
      }
    }
    if (toClear.length > 0) {
      await db.from("email_receipts").update({ transaction_id: null }).in("id", toClear);
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
