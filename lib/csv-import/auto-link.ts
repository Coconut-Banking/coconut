import { getSupabase } from "../supabase";
import type { ParsedP2PRow } from "./parsers";

export type LinkConfidence = "auto" | "suggested" | "manual" | null;

export interface LinkCandidate {
  transactionId: string;
  date: string;
  amount: number;
  merchant: string;
  confidence: LinkConfidence;
}

export interface LinkResult {
  p2pExternalId: string;
  linkedTransactionId: string | null;
  confidence: LinkConfidence;
  candidates: LinkCandidate[];
}

/**
 * Auto-link P2P transactions to Plaid bank transactions using confidence scoring.
 *
 * High confidence (auto-link): Same date, same absolute amount, merchant contains platform name, only one candidate
 * Medium confidence (suggest): Same date +/- 1 day, same amount, platform match, multiple candidates
 * Low confidence (skip): Ambiguous matches -> leave unlinked
 */
export async function autoLinkTransactions(
  clerkUserId: string,
  rows: ParsedP2PRow[]
): Promise<LinkResult[]> {
  if (rows.length === 0) return [];

  const db = getSupabase();

  // Get the date range of imported rows
  const dates = rows.map((r) => r.date).sort();
  const minDate = dates[0];
  const maxDate = dates[dates.length - 1];

  // Expand range by 1 day each side for fuzzy matching
  const startDate = shiftDate(minDate, -1);
  const endDate = shiftDate(maxDate, 1);

  // Fetch bank transactions in the date range
  const { data: bankTxns } = await db
    .from("transactions")
    .select("id, date, amount, merchant_name, raw_name")
    .eq("clerk_user_id", clerkUserId)
    .gte("date", startDate)
    .lte("date", endDate);

  if (!bankTxns || bankTxns.length === 0) {
    return rows.map((r) => ({
      p2pExternalId: r.externalId,
      linkedTransactionId: null,
      confidence: null,
      candidates: [],
    }));
  }

  // Track which bank txns have already been linked to avoid double-linking
  const usedBankTxnIds = new Set<string>();

  const results: LinkResult[] = [];

  for (const row of rows) {
    const absAmount = Math.abs(row.amount);
    const candidates: LinkCandidate[] = [];

    for (const btx of bankTxns) {
      if (usedBankTxnIds.has(btx.id)) continue;

      const bankAmount = Math.abs(Number(btx.amount));
      const amountMatch = Math.abs(bankAmount - absAmount) < 0.02; // within 2 cents
      if (!amountMatch) continue;

      const merchant = ((btx.merchant_name || btx.raw_name || "") as string).toLowerCase();
      const platformMatch = merchantMatchesPlatform(merchant, row.platform);
      const dateDiff = daysBetween(row.date, btx.date as string);

      let confidence: LinkConfidence = null;

      if (dateDiff === 0 && platformMatch) {
        confidence = "auto";
      } else if (dateDiff <= 1 && platformMatch) {
        confidence = "suggested";
      } else if (dateDiff <= 1) {
        confidence = "suggested";
      }

      if (confidence) {
        candidates.push({
          transactionId: btx.id as string,
          date: btx.date as string,
          amount: bankAmount,
          merchant: (btx.merchant_name || btx.raw_name || "Unknown") as string,
          confidence,
        });
      }
    }

    // Determine final link
    let linkedId: string | null = null;
    let finalConfidence: LinkConfidence = null;

    const autoMatches = candidates.filter((c) => c.confidence === "auto");
    if (autoMatches.length === 1) {
      // High confidence: exactly one auto match
      linkedId = autoMatches[0].transactionId;
      finalConfidence = "auto";
      usedBankTxnIds.add(linkedId);
    } else if (candidates.length === 1) {
      // Single suggested match
      linkedId = candidates[0].transactionId;
      finalConfidence = "suggested";
      usedBankTxnIds.add(linkedId);
    }
    // Multiple candidates: leave for user to decide

    results.push({
      p2pExternalId: row.externalId,
      linkedTransactionId: linkedId,
      confidence: finalConfidence,
      candidates,
    });
  }

  return results;
}

function merchantMatchesPlatform(merchant: string, platform: string): boolean {
  const platformKeywords: Record<string, string[]> = {
    venmo: ["venmo"],
    cashapp: ["cash app", "cashapp", "square cash"],
    paypal: ["paypal"],
  };
  const keywords = platformKeywords[platform] ?? [];
  return keywords.some((kw) => merchant.includes(kw));
}

function daysBetween(date1: string, date2: string): number {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  return Math.abs(Math.floor((d1.getTime() - d2.getTime()) / (24 * 60 * 60 * 1000)));
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
