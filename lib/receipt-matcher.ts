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
  chipotle: ["chipotle", "chipotle mexican"],
  wholefoods: ["whole foods", "whole fds", "wfm"],
  traderjoes: ["trader joes", "trader joe"],
  cvs: ["cvs", "cvs pharmacy"],
  walgreens: ["walgreens", "wag"],
  hulu: ["hulu"],
  youtube: ["youtube", "google youtube"],
  delta: ["delta", "delta air lines", "delta air"],
  united: ["united", "united airlines"],
  southwest: ["southwest", "southwest air", "southwest airlines"],
  hilton: ["hilton", "hilton hotels"],
  marriott: ["marriott"],
  chickfila: ["chick fil a", "chick fila", "cfa"],
  panera: ["panera", "panera bread"],
  dominos: ["dominos", "domino"],
  bestbuy: ["best buy", "bestbuy"],
  homedepot: ["home depot", "homedepot"],
  lowes: ["lowes", "lowe"],
  fantuan: ["fantuan", "fantuanorder"],
  skipthedishes: ["skip the dishes", "skipthedishes"],
};

const POS_PREFIXES = [
  "sq *", "sq*", "tst *", "tst*", "pp *", "pp*",
  "paypal *", "paypal*", "cke *", "cke*", "sp *", "sp*",
  "google *", "google*", "apl* ", "apl*", "ghl*", "ghl *",
  "int *", "int*",
];

function stripPosPrefix(merchant: string): string {
  const lower = merchant.toLowerCase();
  for (const prefix of POS_PREFIXES) {
    if (lower.startsWith(prefix)) {
      return merchant.slice(prefix.length).trim();
    }
  }
  return merchant;
}

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
  const b = normalizeMerchant(stripPosPrefix(txMerchant));
  if (!a || !b) return false;

  if (a.includes(b) || b.includes(a)) return true;

  const aKeywords = a.split(" ").filter((w) => w.length >= 3);
  if (aKeywords.some((kw) => b.includes(kw))) return true;

  const bKeywords = b.split(" ").filter((w) => w.length >= 3);
  if (bKeywords.some((kw) => a.includes(kw))) return true;

  const aAliases = resolveAliases(receiptMerchant);
  const bAliases = resolveAliases(stripPosPrefix(txMerchant));
  if (aAliases.length > 0 && bAliases.length > 0) {
    if (aAliases.some((aa) => bAliases.includes(aa))) return true;
  }
  if (aAliases.some((aa) => b.includes(aa))) return true;
  if (bAliases.some((ba) => a.includes(ba))) return true;

  return false;
}

function amountWithinTolerance(receiptAmount: number, txAmount: number): boolean {
  // Exact match only — $0.01 rounding buffer for floating-point representation.
  // Loose dollar/percent tolerances caused too many false matches on small amounts.
  return Math.abs(txAmount - receiptAmount) <= 0.01;
}

/**
 * Returns true when both merchant strings resolve to known-distinct alias groups.
 * Used to reject Strategy 3 amount-only matches where the merchants are clearly
 * different entities (e.g. "Airbnb" vs "Clipper Transit Fare").
 */
function knownMerchantsConflict(m1: string, m2: string): boolean {
  if (!m1 || !m2) return false;
  const a1 = resolveAliases(m1);
  const a2 = resolveAliases(m2);
  // Both are recognised merchants and share no alias group → definitively different
  return a1.length > 0 && a2.length > 0 && !a1.some((a) => a2.includes(a));
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

  const [{ data: receipts }, { data: alreadyLinked }] = await Promise.all([
    db
      .from("email_receipts")
      .select("id, merchant, amount, date, subtotal")
      .in("id", receiptIds)
      .is("transaction_id", null),
    db
      .from("email_receipts")
      .select("transaction_id")
      .eq("clerk_user_id", clerkUserId)
      .not("transaction_id", "is", null),
  ]);

  if (!receipts || receipts.length === 0) return 0;

  const alreadyMatchedTxIds = new Set(
    (alreadyLinked ?? []).map((r) => r.transaction_id as string).filter(Boolean)
  );

  const windowDays = RECEIPT_MATCH.DATE_WINDOW_DAYS;

  // Collect the overall date range covering ALL receipts (+ window on each side)
  let globalMinDate: Date | null = null;
  let globalMaxDate: Date | null = null;
  for (const receipt of receipts) {
    if (!receipt.date) continue;
    const d = new Date(receipt.date);
    const lo = new Date(d); lo.setDate(lo.getDate() - windowDays);
    const hi = new Date(d); hi.setDate(hi.getDate() + windowDays);
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

  const tightWindowDays = 5;

  let matched = 0;
  const pendingUpdates: Array<{ id: string; transaction_id: string }> = [];
  const debugUnmatched: Array<{ merchant: string; amount: number; date: string | null; reason: string }> = [];

  for (const receipt of receipts) {
    if (!receipt.merchant || !receipt.amount) continue;

    const receiptAmount = Math.abs(Number(receipt.amount));
    const receiptSubtotal = receipt.subtotal != null ? Math.abs(Number(receipt.subtotal)) : null;
    const receiptDate = receipt.date;

    const amountsToTry = [receiptAmount];
    if (receiptSubtotal != null && Math.abs(receiptSubtotal - receiptAmount) > 0.01) {
      amountsToTry.push(receiptSubtotal);
    }

    let dateStart: string | undefined;
    let dateEnd: string | undefined;
    let tightStart: string | undefined;
    let tightEnd: string | undefined;
    if (receiptDate) {
      const dateObj = new Date(receiptDate);
      const start = new Date(dateObj); start.setDate(start.getDate() - windowDays);
      const end = new Date(dateObj); end.setDate(end.getDate() + windowDays);
      dateStart = start.toISOString().split("T")[0];
      dateEnd = end.toISOString().split("T")[0];

      const ts = new Date(dateObj); ts.setDate(ts.getDate() - tightWindowDays);
      const te = new Date(dateObj); te.setDate(te.getDate() + tightWindowDays);
      tightStart = ts.toISOString().split("T")[0];
      tightEnd = te.toISOString().split("T")[0];
    }

    const windowCandidates = allCandidates.filter((tx) => {
      if (alreadyMatchedTxIds.has(tx.id)) return false;
      if (!dateStart || !dateEnd) return true;
      return tx.date >= dateStart && tx.date <= dateEnd;
    });

    const keywords = extractKeywords(receipt.merchant);
    let bestMatchId: string | null = null;

    for (const tryAmount of amountsToTry) {
      if (bestMatchId) break;

      // ── Strategy 1: keyword match in-memory ──
      if (keywords.length > 0) {
        for (const keyword of keywords) {
          const kwLower = keyword.toLowerCase();
          const keywordMatches = windowCandidates.filter((tx) => {
            const nm = stripPosPrefix(tx.normalized_merchant ?? "").toLowerCase();
            const mn = stripPosPrefix(tx.merchant_name ?? "").toLowerCase();
            return nm.includes(kwLower) || mn.includes(kwLower);
          });
          if (keywordMatches.length > 0) {
            bestMatchId = scoreCandidates(
              keywordMatches as Array<{ id: string; amount: number; date: string; normalized_merchant?: string; merchant_name?: string }>,
              tryAmount,
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
              amountDiff: Math.abs(txAmount - tryAmount),
              dateDiff,
              txAmount,
            };
          })
          .filter((s) => amountWithinTolerance(tryAmount, tryAmount + s.amountDiff) && isFinite(s.dateDiff))
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
              amountDiff: Math.abs(txAmount - tryAmount),
              dateDiff: Math.abs(new Date(tx.date).getTime() - new Date(receiptDate).getTime()),
            };
          })
          .filter((s) => s.amountDiff <= 0.01)
          .sort((a, b) => a.amountDiff - b.amountDiff || a.dateDiff - b.dateDiff);

        if (scored.length > 0) {
          bestMatchId = scored[0].id;
        }
      }
    }

    if (!bestMatchId) {
      const closest = windowCandidates
        .map((tx) => {
          const txAmount = Math.abs(Number(tx.amount));
          const txMerch = tx.normalized_merchant || tx.merchant_name || "";
          return {
            amountDiff: Math.abs(txAmount - receiptAmount),
            merchant: txMerch,
            merchantMatch: txMerch ? merchantsMatch(receipt.merchant, txMerch) : false,
          };
        })
        .sort((a, b) => a.amountDiff - b.amountDiff);
      const best = closest[0];
      let reason = `no candidates in ±${windowDays}d window`;
      if (best) {
        const parts: string[] = [];
        if (best.amountDiff > 0.01) parts.push(`closest amount diff=$${best.amountDiff.toFixed(2)}`);
        if (!best.merchantMatch) parts.push(`merchant mismatch (tx="${best.merchant}")`);
        if (parts.length === 0) parts.push("unknown");
        reason = parts.join("; ");
      }
      debugUnmatched.push({
        merchant: receipt.merchant,
        amount: receiptAmount,
        date: receiptDate,
        reason,
      });
      continue;
    }

    pendingUpdates.push({ id: receipt.id as string, transaction_id: bestMatchId });
    alreadyMatchedTxIds.add(bestMatchId);
    matched++;
  }

  if (debugUnmatched.length > 0) {
    console.log(`[receipt-matcher] ${debugUnmatched.length} unmatched receipts:`);
    for (const d of debugUnmatched.slice(0, 15)) {
      console.log(`  ${d.merchant} $${d.amount} (${d.date ?? "no date"}) — ${d.reason}`);
    }
    if (debugUnmatched.length > 15) {
      console.log(`  ... and ${debugUnmatched.length - 15} more`);
    }
  }

  if (pendingUpdates.length > 0) {
    await Promise.all(
      pendingUpdates.map((u) =>
        db.from("email_receipts").update({ transaction_id: u.transaction_id }).eq("id", u.id)
      )
    );
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

  const toClear = matchedReceipts
    .filter((r) => !validTxIds.has(r.transaction_id as string))
    .map((r) => r.id as string);

  if (toClear.length > 0) {
    await db.from("email_receipts").update({ transaction_id: null }).in("id", toClear);
  }

  return toClear.length;
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
      const tightAmountOk = Math.abs(txAmount - rcptAmount) <= 0.01;
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
