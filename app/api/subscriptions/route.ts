import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { revalidateTag } from "next/cache";
import { getSupabase } from "@/lib/supabase";
import { CACHE_TAGS } from "@/lib/cached-queries";
import {
  detectSubscriptionsForUser,
  saveDetectedSubscriptions,
  deleteExcludedSubscriptions,
} from "@/lib/subscription-detect";
import { getEffectiveUserId } from "@/lib/demo";

function addMonth(dateStr: string | null | undefined): string {
  if (!dateStr || typeof dateStr !== "string") {
    const fallback = new Date();
    fallback.setMonth(fallback.getMonth() + 1);
    return fallback.toISOString().slice(0, 10);
  }
  const d = new Date(dateStr + "T12:00:00");
  if (isNaN(d.getTime())) {
    const fallback = new Date();
    fallback.setMonth(fallback.getMonth() + 1);
    return fallback.toISOString().slice(0, 10);
  }
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}

export async function GET() {
  const effectiveUserId = await getEffectiveUserId();
  if (!effectiveUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const db = getSupabase();
    const { data, error } = await db.from("subscriptions").select("id, merchant_name, amount, frequency, last_charge_date, next_due_date, primary_category, transaction_count, status, previous_amount, price_change_amount, price_change_detected_at, confidence").eq("clerk_user_id", effectiveUserId).eq("status", "active").order("amount", { ascending: false }).limit(200);
    if (error) throw error;
    const subs = (data ?? []).map((s) => ({
      id: s.id,
      merchant: s.merchant_name ?? "Unknown",
      amount: Number(s.amount) || 0,
      frequency: s.frequency ?? "monthly",
      lastCharged: s.last_charge_date ?? null,
      nextDue: s.next_due_date ?? null,
      category: (s.primary_category ?? "SUBSCRIPTIONS").replace(/_/g, " "),
      transactionCount: s.transaction_count ?? 0,
      status: s.status ?? "active",
      confidence: s.confidence != null ? Number(s.confidence) : null,
      priceChange: s.price_change_detected_at ? {
        previous: Number(s.previous_amount) || 0,
        change: Number(s.price_change_amount) || 0,
        detectedAt: s.price_change_detected_at,
      } : null,
    }));
    return NextResponse.json(subs);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json().catch(() => ({}));
    const transactionId = body?.transactionId as string | undefined;
    if (transactionId) {
      const db = getSupabase();
      const { data: tx, error: txErr } = await db.from("transactions").select("id, merchant_name, raw_name, normalized_merchant, amount, date, primary_category").eq("id", transactionId).eq("clerk_user_id", userId).single();
      if (txErr || !tx) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
      const merchant = (tx.merchant_name || tx.raw_name || "Unknown") as string;
      const normalized = (tx.normalized_merchant as string) || merchant.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
      const { error } = await db.from("subscriptions").upsert({ clerk_user_id: userId, merchant_name: merchant, normalized_merchant: normalized, amount: Math.abs(tx.amount as number), frequency: "monthly", last_charge_date: tx.date, next_due_date: addMonth(tx.date as string), primary_category: tx.primary_category || "SUBSCRIPTIONS", transaction_count: 1, status: "active", updated_at: new Date().toISOString() }, { onConflict: "clerk_user_id,normalized_merchant" });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ added: true });
    }
    // Sync transactions first so we have fresh data for detection
    try {
      const { syncTransactionsForUser } = await import("@/lib/transaction-sync");
      await syncTransactionsForUser(userId);
    } catch (e) {
      console.warn("[subscriptions] pre-detect sync failed:", e instanceof Error ? e.message : e);
    }
    const removed = await deleteExcludedSubscriptions(userId);
    const detected = await detectSubscriptionsForUser(userId);
    await saveDetectedSubscriptions(userId, detected);
    revalidateTag(CACHE_TAGS.transactions(userId), "max");
    return NextResponse.json({ detected: detected.length, removed });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
