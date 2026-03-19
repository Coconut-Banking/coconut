export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { searchTransactions } from "@/lib/search";
import { SEARCH } from "@/lib/config";
import { getEffectiveUserId } from "@/lib/demo";
import { rateLimit } from "@/lib/rate-limit";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin, getSupabaseForUser } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const { userId: clerkUserId, getToken } = await auth();
  const userId = await getEffectiveUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = rateLimit(`search:${userId}`, 60, 60_000);
  if (!rl.success) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const q = request.nextUrl.searchParams.get("q") ?? "";
  const limit = Math.min(Number(request.nextUrl.searchParams.get("limit")) || SEARCH.DEFAULT_LIMIT, SEARCH.MAX_LIMIT);
  const bypassCache = request.nextUrl.searchParams.get("refresh") === "1";

  try {
    const token = clerkUserId ? await getToken({ template: "supabase" }) : null;
    const db = getSupabaseForUser(token) ?? getSupabaseAdmin();

    // Direct query so RLS is enforced when available
    const { data: rows, error } = await db
      .from("transactions")
      .select("id, plaid_transaction_id, merchant_name, raw_name, amount, date, primary_category")
      .eq("clerk_user_id", userId)
      .order("date", { ascending: false })
      .order("id", { ascending: false })
      .limit(bypassCache ? 2000 : 2000);
    if (error) throw new Error(error.message);

    const transactions = (rows ?? []).map((r) => ({
    id: r.plaid_transaction_id as string,
    merchant: (r.merchant_name || r.raw_name || "Unknown") as string,
    amount: r.amount,
    date: r.date,
    category: (r.primary_category ?? "OTHER").replace(/_/g, " "),
    rawDescription: (r.raw_name ?? "") as string,
  }));

  const results = searchTransactions(transactions, q, limit);
  return NextResponse.json(results);
  } catch (err) {
    console.error("[search]", err);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
