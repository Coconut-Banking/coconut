/**
 * Subscription detection — three-layer strategy:
 *   1. Known merchant database (single transaction is enough)
 *   2. Transaction pattern analysis (recurring charges)
 *   3. Email receipt cross-referencing
 *
 * Results are merged and deduplicated by normalized merchant.
 */

import { getSupabase } from "./supabase";
import { shouldExcludeAsSubscription } from "./subscription-config";
import { matchKnownSubscription } from "./known-subscriptions";

export async function deleteExcludedSubscriptions(clerkUserId: string): Promise<number> {
  const db = getSupabase();
  const { data: rows } = await db
    .from("subscriptions")
    .select("id, merchant_name, primary_category")
    .eq("clerk_user_id", clerkUserId)
    .eq("status", "active");
  if (!rows?.length) return 0;
  const toDelete = rows.filter((r) =>
    shouldExcludeAsSubscription(r.primary_category, r.merchant_name ?? "", "")
  );
  if (toDelete.length === 0) return 0;
  const ids = toDelete.map((r) => r.id);
  await db.from("subscriptions").delete().in("id", ids);
  return ids.length;
}

export type SubscriptionFrequency = "weekly" | "biweekly" | "monthly" | "quarterly" | "semiannual" | "yearly";

export interface DetectedSubscription {
  merchantName: string;
  normalizedMerchant: string;
  amount: number;
  frequency: SubscriptionFrequency;
  lastChargeDate: string;
  nextDueDate: string;
  primaryCategory: string;
  transactionCount: number;
  transactionIds: string[];
  transactionDetails: Array<{ id: string; amount: number; date: string }>;
  source: "known" | "pattern" | "email";
  confidence: number;
}

interface TxRow {
  id: string;
  merchant_name: string | null;
  raw_name: string | null;
  normalized_merchant: string | null;
  amount: number;
  date: string;
  primary_category: string | null;
}

// ── Tuning constants ──────────────────────────────────────────────────────────

const AMOUNT_TOLERANCE = 0.25;
const MIN_OCCURRENCES = 2;
const DAYS_WEEKLY = { min: 5, max: 10 };
const DAYS_BIWEEKLY = { min: 11, max: 18 };
const DAYS_MONTHLY = { min: 22, max: 38 };
const DAYS_QUARTERLY = { min: 80, max: 100 };
const DAYS_SEMIANNUAL = { min: 170, max: 200 };
const DAYS_YEARLY = { min: 340, max: 395 };

const MERCHANT_STRIP_SUFFIXES = [
  "inc", "llc", "ltd", "co", "corp", "corporation", "limited",
  "subscription", "membership", "recurring", "autopay", "auto pay",
  "monthly", "annual", "yearly", "payment", "billing",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const PLAID_PREFIXES = ["sq ", "tst ", "sp ", "pos "];

function normalizeMerchantName(raw: string): string {
  let s = raw.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  // Strip common domain suffixes for better matching (netflix.com -> netflix)
  s = s.replace(/\s*(com|net|org|co|tv|io)\s*$/g, "").trim();
  // Strip common Plaid POS prefixes (Square, Toast, Shopify POS)
  for (const prefix of PLAID_PREFIXES) {
    if (s.startsWith(prefix)) {
      s = s.slice(prefix.length).trim();
    }
  }
  for (const suffix of MERCHANT_STRIP_SUFFIXES) {
    s = s.replace(new RegExp(`\\b${suffix}\\b`, "g"), "").trim();
  }
  return s.replace(/\s+/g, " ").trim();
}

function amountsMatch(a: number, b: number): boolean {
  const absA = Math.abs(a);
  if (absA < 1) return Math.abs(a - b) < 0.5;
  return Math.abs(a - b) / absA <= AMOUNT_TOLERANCE;
}

function daysBetween(d1: string, d2: string): number {
  return Math.round(Math.abs(new Date(d2).getTime() - new Date(d1).getTime()) / (1000 * 60 * 60 * 24));
}

function inferFrequency(dayDiffs: number[]): SubscriptionFrequency | null {
  const avg = dayDiffs.reduce((s, d) => s + d, 0) / dayDiffs.length;
  if (avg >= DAYS_WEEKLY.min && avg <= DAYS_WEEKLY.max) return "weekly";
  if (avg >= DAYS_BIWEEKLY.min && avg <= DAYS_BIWEEKLY.max) return "biweekly";
  if (avg >= DAYS_MONTHLY.min && avg <= DAYS_MONTHLY.max) return "monthly";
  if (avg >= DAYS_QUARTERLY.min && avg <= DAYS_QUARTERLY.max) return "quarterly";
  if (avg >= DAYS_SEMIANNUAL.min && avg <= DAYS_SEMIANNUAL.max) return "semiannual";
  if (avg >= DAYS_YEARLY.min && avg <= DAYS_YEARLY.max) return "yearly";
  return null;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function frequencyToDays(freq: SubscriptionFrequency): number {
  switch (freq) {
    case "weekly": return 7;
    case "biweekly": return 14;
    case "monthly": return 30;
    case "quarterly": return 90;
    case "semiannual": return 182;
    case "yearly": return 365;
  }
}

// ── Strategy 1: Known Merchant Match ──────────────────────────────────────────

function detectFromKnownMerchants(
  txs: TxRow[],
  alreadyFound: Set<string>,
): DetectedSubscription[] {
  const results: DetectedSubscription[] = [];
  const seenKnown = new Set<string>();

  for (const tx of txs) {
    const raw = tx.merchant_name || tx.raw_name || tx.normalized_merchant || "";
    const normalized = normalizeMerchantName(raw);
    if (!normalized || normalized.length < 2) continue;

    const known = matchKnownSubscription(raw) ?? matchKnownSubscription(normalized);
    if (!known) continue;

    const knownKey = known.name.toLowerCase();
    if (seenKnown.has(knownKey) || alreadyFound.has(normalized)) continue;
    seenKnown.add(knownKey);

    // Known merchant matches are never excluded by bill heuristics —
    // the curated database is authoritative.

    const allMatchingTxs = txs.filter((t) => {
      const tRaw = t.merchant_name || t.raw_name || t.normalized_merchant || "";
      const tKnown = matchKnownSubscription(tRaw) ?? matchKnownSubscription(normalizeMerchantName(tRaw));
      return tKnown?.name === known.name;
    });

    allMatchingTxs.sort((a, b) => b.date.localeCompare(a.date));
    const latest = allMatchingTxs[0];
    const avgAmount = allMatchingTxs.reduce((s, t) => s + Math.abs(t.amount), 0) / allMatchingTxs.length;

    let frequency: SubscriptionFrequency = known.defaultFrequency;
    if (allMatchingTxs.length >= 2) {
      const dayDiffs: number[] = [];
      for (let i = 0; i < allMatchingTxs.length - 1; i++) {
        dayDiffs.push(daysBetween(allMatchingTxs[i].date, allMatchingTxs[i + 1].date));
      }
      const inferred = inferFrequency(dayDiffs);
      if (inferred) frequency = inferred;
    }

    const nextDue = addDays(latest.date, frequencyToDays(frequency));

    results.push({
      merchantName: known.name,
      normalizedMerchant: normalized,
      amount: Math.abs(avgAmount),
      frequency,
      lastChargeDate: latest.date,
      nextDueDate: nextDue,
      primaryCategory: known.category,
      transactionCount: allMatchingTxs.length,
      transactionIds: allMatchingTxs.map((t) => t.id),
      transactionDetails: allMatchingTxs.map((t) => ({ id: t.id, amount: Math.abs(t.amount), date: t.date })),
      source: "known",
      confidence: 0.95,
    });

    alreadyFound.add(normalized);
  }

  return results;
}

// ── Strategy 2: Transaction Pattern Analysis ──────────────────────────────────

function detectFromPatterns(
  txs: TxRow[],
  alreadyFound: Set<string>,
): DetectedSubscription[] {
  const byMerchant = new Map<string, TxRow[]>();

  for (const tx of txs) {
    const raw = tx.normalized_merchant || tx.merchant_name || tx.raw_name || "";
    const key = normalizeMerchantName(raw);
    if (!key || key.length < 3) continue;
    if (alreadyFound.has(key)) continue;
    const list = byMerchant.get(key) ?? [];
    list.push(tx);
    byMerchant.set(key, list);
  }

  const results: DetectedSubscription[] = [];

  for (const [key, list] of byMerchant) {
    if (list.length < MIN_OCCURRENCES) continue;
    list.sort((a, b) => b.date.localeCompare(a.date));

    const amounts = list.map((t) => Math.abs(t.amount));
    const avgAmount = amounts.reduce((s, v) => s + v, 0) / amounts.length;
    if (!amounts.every((v) => amountsMatch(v, avgAmount))) continue;

    const dayDiffs: number[] = [];
    for (let i = 0; i < list.length - 1; i++) {
      dayDiffs.push(daysBetween(list[i].date, list[i + 1].date));
    }
    const frequency = inferFrequency(dayDiffs);
    if (!frequency) continue;

    const lastTx = list[0];
    const merchant = lastTx.merchant_name || lastTx.raw_name || lastTx.normalized_merchant || "Unknown";
    const rawName = (lastTx.raw_name || "").trim();
    if (shouldExcludeAsSubscription(lastTx.primary_category, merchant, rawName)) continue;

    const avgDays = dayDiffs.reduce((s, d) => s + d, 0) / dayDiffs.length;
    const nextDue = addDays(lastTx.date, Math.round(avgDays));

    results.push({
      merchantName: merchant,
      normalizedMerchant: key,
      amount: Math.abs(avgAmount),
      frequency,
      lastChargeDate: lastTx.date,
      nextDueDate: nextDue,
      primaryCategory: lastTx.primary_category || "SUBSCRIPTIONS",
      transactionCount: list.length,
      transactionIds: list.map((t) => t.id),
      transactionDetails: list.map((t) => ({ id: t.id, amount: Math.abs(t.amount), date: t.date })),
      source: "pattern",
      confidence: list.length >= 4 ? 0.85 : 0.65,
    });

    alreadyFound.add(key);
  }

  return results;
}

// ── Strategy 3: Email Receipt Cross-Reference ─────────────────────────────────

interface EmailReceiptRow {
  merchant: string;
  amount: number;
  date: string;
}

async function detectFromEmailReceipts(
  clerkUserId: string,
  txs: TxRow[],
  alreadyFound: Set<string>,
): Promise<DetectedSubscription[]> {
  const db = getSupabase();
  const { data: receipts } = await db
    .from("email_receipts")
    .select("merchant, amount, date")
    .eq("clerk_user_id", clerkUserId)
    .order("date", { ascending: false });

  if (!receipts || receipts.length < 2) return [];

  const byMerchant = new Map<string, EmailReceiptRow[]>();
  for (const r of receipts as EmailReceiptRow[]) {
    const key = normalizeMerchantName(r.merchant || "");
    if (!key || key.length < 2) continue;
    if (alreadyFound.has(key)) continue;
    const list = byMerchant.get(key) ?? [];
    list.push(r);
    byMerchant.set(key, list);
  }

  const results: DetectedSubscription[] = [];

  for (const [key, list] of byMerchant) {
    if (list.length < MIN_OCCURRENCES) continue;
    list.sort((a, b) => b.date.localeCompare(a.date));

    const amounts = list.map((r) => Math.abs(r.amount));
    const avgAmount = amounts.reduce((s, v) => s + v, 0) / amounts.length;
    if (!amounts.every((v) => amountsMatch(v, avgAmount))) continue;

    const dayDiffs: number[] = [];
    for (let i = 0; i < list.length - 1; i++) {
      dayDiffs.push(daysBetween(list[i].date, list[i + 1].date));
    }
    const frequency = inferFrequency(dayDiffs);
    if (!frequency) continue;

    const latest = list[0];

    // Exclude bills from email-detected subscriptions
    if (shouldExcludeAsSubscription(null, latest.merchant, "")) continue;

    // Find matching transactions for these email receipts
    const matchingTxs = txs.filter((tx) => {
      const txKey = normalizeMerchantName(tx.merchant_name || tx.raw_name || tx.normalized_merchant || "");
      return txKey === key || txKey.includes(key) || key.includes(txKey);
    });
    const avgDays = dayDiffs.reduce((s, d) => s + d, 0) / dayDiffs.length;
    const nextDue = addDays(latest.date, Math.round(avgDays));

    results.push({
      merchantName: latest.merchant,
      normalizedMerchant: key,
      amount: Math.abs(avgAmount),
      frequency,
      lastChargeDate: latest.date,
      nextDueDate: nextDue,
      primaryCategory: "SUBSCRIPTIONS",
      transactionCount: Math.max(list.length, matchingTxs.length),
      transactionIds: matchingTxs.map((t) => t.id),
      transactionDetails: matchingTxs.map((t) => ({ id: t.id, amount: Math.abs(t.amount), date: t.date })),
      source: "email",
      confidence: 0.55,
    });

    alreadyFound.add(key);
  }

  return results;
}

// ── Main detection entrypoint ─────────────────────────────────────────────────

const SUBSCRIPTION_LOOKBACK_DAYS = 365;

export async function detectSubscriptionsForUser(clerkUserId: string): Promise<DetectedSubscription[]> {
  const db = getSupabase();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - SUBSCRIPTION_LOOKBACK_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const { data: rows, error } = await db
    .from("transactions")
    .select("id, merchant_name, raw_name, normalized_merchant, amount, date, primary_category")
    .eq("clerk_user_id", clerkUserId)
    .lt("amount", 0)
    .gte("date", cutoffStr)
    .order("date", { ascending: false })
    .order("id", { ascending: false });

  if (error) {
    console.error("[subscription-detect] Failed to load transactions:", error.message);
    return [];
  }

  const txs = (rows ?? []) as TxRow[];

  console.log(`[subscription-detect] Loaded ${txs.length} expense transactions (amount < 0) since ${cutoffStr}`);
  if (txs.length === 0) {
    console.warn("[subscription-detect] Zero transactions loaded — check amount sign convention (expenses should be negative)");
  }

  const alreadyFound = new Set<string>();

  // Layer 1: Known merchants (highest priority — needs only 1 transaction)
  const fromKnown = detectFromKnownMerchants(txs, alreadyFound);

  // Layer 2: Transaction patterns (needs 2+ recurring charges)
  const fromPatterns = detectFromPatterns(txs, alreadyFound);

  // Layer 3: Email receipt patterns (needs 2+ email receipts from same merchant)
  const fromEmail = await detectFromEmailReceipts(clerkUserId, txs, alreadyFound);

  const all = [...fromKnown, ...fromPatterns, ...fromEmail];

  console.log(
    `[subscription-detect] Detected ${all.length} subscriptions:`,
    `${fromKnown.length} known, ${fromPatterns.length} pattern, ${fromEmail.length} email`
  );

  return all;
}

// ── Save to database ──────────────────────────────────────────────────────────

export async function saveDetectedSubscriptions(clerkUserId: string, detected: DetectedSubscription[]): Promise<void> {
  const db = getSupabase();

  for (const d of detected) {
    const { data: existing } = await db
      .from("subscriptions")
      .select("id, status, amount")
      .eq("clerk_user_id", clerkUserId)
      .eq("normalized_merchant", d.normalizedMerchant)
      .maybeSingle();

    if (existing?.status === "dismissed") continue;

    // Detect price changes: >$0.50 or >5% difference
    const priceChangeFields: Record<string, unknown> = {};
    if (existing?.amount != null) {
      const oldAmount = Number(existing.amount);
      const diff = d.amount - oldAmount;
      const absDiff = Math.abs(diff);
      const pctChange = oldAmount > 0 ? absDiff / oldAmount : 0;
      // Only flag if: (absolute change > $0.50) OR (percentage > 5% AND amount >= $1.00)
      const isSignificant = absDiff > 0.50 || (pctChange > 0.05 && oldAmount >= 1.00);
      if (isSignificant) {
        priceChangeFields.previous_amount = oldAmount;
        priceChangeFields.price_change_amount = diff;
        priceChangeFields.price_change_detected_at = new Date().toISOString();
      }
    }

    const { error } = await db
      .from("subscriptions")
      .upsert(
        {
          clerk_user_id: clerkUserId,
          merchant_name: d.merchantName,
          normalized_merchant: d.normalizedMerchant,
          amount: d.amount,
          frequency: d.frequency,
          last_charge_date: d.lastChargeDate,
          next_due_date: d.nextDueDate,
          primary_category: d.primaryCategory,
          transaction_count: d.transactionCount,
          confidence: d.confidence,
          status: "active",
          updated_at: new Date().toISOString(),
          ...priceChangeFields,
        },
        { onConflict: "clerk_user_id,normalized_merchant" }
      );

    if (error) continue;

    if (d.transactionDetails.length > 0) {
      const { data: sub } = await db
        .from("subscriptions")
        .select("id")
        .eq("clerk_user_id", clerkUserId)
        .eq("normalized_merchant", d.normalizedMerchant)
        .maybeSingle();

      if (sub) {
        try {
          for (const td of d.transactionDetails.slice(0, 10)) {
            await db.from("subscription_transactions").upsert(
              { subscription_id: sub.id, transaction_id: td.id, amount: td.amount, date: td.date },
              { onConflict: "subscription_id,transaction_id" }
            );
          }
        } catch {
          // best-effort
        }
      }
    }
  }
}
