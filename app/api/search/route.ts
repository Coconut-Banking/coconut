import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { searchTransactions } from "@/lib/search";
import { SEARCH } from "@/lib/config";

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = request.nextUrl.searchParams.get("q") ?? "";
  const limit = Math.min(Number(request.nextUrl.searchParams.get("limit")) || SEARCH.DEFAULT_LIMIT, SEARCH.MAX_LIMIT);

  const db = getSupabase();
  const { data: rows } = await db
    .from("transactions")
    .select("id, plaid_transaction_id, merchant_name, raw_name, amount, date, primary_category")
    .eq("clerk_user_id", userId)
    .order("date", { ascending: false })
    .limit(SEARCH.TX_FETCH_LIMIT);

  const transactions = (rows ?? []).map((r) => ({
    id: r.plaid_transaction_id,
    merchant: r.merchant_name || r.raw_name || "Unknown",
    amount: r.amount,
    date: r.date,
    category: (r.primary_category ?? "OTHER").replace(/_/g, " "),
    rawDescription: r.raw_name ?? "",
  }));

  const results = searchTransactions(transactions, q, limit);
  return NextResponse.json(results);
}
