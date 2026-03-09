import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import {
  detectSubscriptionsForUser,
  saveDetectedSubscriptions,
  deleteExcludedSubscriptions,
} from "@/lib/subscription-detect";

function addMonth(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}

const DEMO_USER_ID = "demo-sandbox-user";

export async function GET() {
  const { userId } = await auth();
  const effectiveUserId = userId ?? DEMO_USER_ID;
  try {
    const db = getSupabase();
    let { data, error } = await db.from("subscriptions").select("id, merchant_name, amount, frequency, last_charge_date, next_due_date, primary_category, transaction_count, status").eq("clerk_user_id", effectiveUserId).eq("status", "active").order("amount", { ascending: false });
    if (userId && (!data || data.length === 0)) {
      const demo = await db.from("subscriptions").select("id, merchant_name, amount, frequency, last_charge_date, next_due_date, primary_category, transaction_count, status").eq("clerk_user_id", DEMO_USER_ID).eq("status", "active").order("amount", { ascending: false });
      data = demo.data;
      error = demo.error;
    }
    if (error) throw error;
    const subs = (data ?? []).map((s) => ({ id: s.id, merchant: s.merchant_name, amount: Number(s.amount), frequency: s.frequency, lastCharged: s.last_charge_date, nextDue: s.next_due_date, category: (s.primary_category ?? "SUBSCRIPTIONS").replace(/_/g, " "), transactionCount: s.transaction_count ?? 0, status: s.status }));
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
    const removed = await deleteExcludedSubscriptions(userId);
    const detected = await detectSubscriptionsForUser(userId);
    await saveDetectedSubscriptions(userId, detected);
    return NextResponse.json({ detected: detected.length, removed });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
