/**
 * Subscription detection — find recurring charges from transaction history.
 * Excludes bills (rent, utilities, transfers, etc.) per docs/SUBSCRIPTIONS_PLAN.md.
 */

import { getSupabase } from "./supabase";
import { shouldExcludeAsSubscription } from "./subscription-config";

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

export type SubscriptionFrequency = "weekly" | "biweekly" | "monthly" | "yearly";

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

const AMOUNT_TOLERANCE = 0.15;
const MIN_OCCURRENCES = 2;
const DAYS_MONTHLY_MIN = 25;
const DAYS_MONTHLY_MAX = 35;
const DAYS_YEARLY_MIN = 350;
const DAYS_YEARLY_MAX = 380;
const DAYS_WEEKLY_MIN = 6;
const DAYS_WEEKLY_MAX = 9;
const DAYS_BIWEEKLY_MIN = 12;
const DAYS_BIWEEKLY_MAX = 16;

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
  if (avg >= DAYS_WEEKLY_MIN && avg <= DAYS_WEEKLY_MAX) return "weekly";
  if (avg >= DAYS_BIWEEKLY_MIN && avg <= DAYS_BIWEEKLY_MAX) return "biweekly";
  if (avg >= DAYS_MONTHLY_MIN && avg <= DAYS_MONTHLY_MAX) return "monthly";
  if (avg >= DAYS_YEARLY_MIN && avg <= DAYS_YEARLY_MAX) return "yearly";
  return null;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function detectSubscriptionsForUser(clerkUserId: string): Promise<DetectedSubscription[]> {
  const db = getSupabase();
  const { data: rows, error } = await db
    .from("transactions")
    .select("id, merchant_name, raw_name, normalized_merchant, amount, date, primary_category")
    .eq("clerk_user_id", clerkUserId)
    .lt("amount", 0)
    .order("date", { ascending: false });

  if (error || !rows || rows.length < MIN_OCCURRENCES) return [];

  const txs = rows as TxRow[];
  const byMerchant = new Map<string, TxRow[]>();

  for (const tx of txs) {
    const raw = (tx.normalized_merchant || tx.merchant_name || tx.raw_name || "").trim();
    const key = raw.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
    if (!key || key.length < 3) continue;
    const list = byMerchant.get(key) ?? [];
    list.push(tx);
    byMerchant.set(key, list);
  }

  const results: DetectedSubscription[] = [];

  for (const [, list] of byMerchant) {
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
    const normalized =
      (lastTx.normalized_merchant || merchant.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim()) as string;

    results.push({
      merchantName: merchant,
      normalizedMerchant: normalized,
      amount: Math.abs(avgAmount),
      frequency,
      lastChargeDate: lastTx.date,
      nextDueDate: nextDue,
      primaryCategory: lastTx.primary_category || "SUBSCRIPTIONS",
      transactionCount: list.length,
      transactionIds: list.map((t) => t.id),
      transactionDetails: list.map((t) => ({ id: t.id, amount: Math.abs(t.amount), date: t.date })),
    });
  }

  return results;
}

export async function saveDetectedSubscriptions(clerkUserId: string, detected: DetectedSubscription[]): Promise<void> {
  const db = getSupabase();

  for (const d of detected) {
    const { data: existing } = await db
      .from("subscriptions")
      .select("id, status")
      .eq("clerk_user_id", clerkUserId)
      .eq("normalized_merchant", d.normalizedMerchant)
      .maybeSingle();

    if (existing?.status === "dismissed") continue;

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
          status: "active",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "clerk_user_id,normalized_merchant" }
      );

    if (error) continue;

    const { data: sub } = await db
      .from("subscriptions")
      .select("id")
      .eq("clerk_user_id", clerkUserId)
      .eq("normalized_merchant", d.normalizedMerchant)
      .single();

    if (sub && d.transactionDetails.length > 0) {
      try {
        for (const td of d.transactionDetails.slice(0, 10)) {
          await db.from("subscription_transactions").upsert(
            { subscription_id: sub.id, transaction_id: td.id, amount: td.amount, date: td.date },
            { onConflict: "subscription_id,transaction_id" }
          );
        }
      } catch {
        // optional
      }
    }
  }
}
