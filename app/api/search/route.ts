import { NextRequest, NextResponse } from "next/server";
import { searchTransactions } from "@/lib/search";
import { SEARCH } from "@/lib/config";
import { getCachedTransactions } from "@/lib/cached-queries";
import { getEffectiveUserId } from "@/lib/demo";

export async function GET(request: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = request.nextUrl.searchParams.get("q") ?? "";
  const limit = Math.min(Number(request.nextUrl.searchParams.get("limit")) || SEARCH.DEFAULT_LIMIT, SEARCH.MAX_LIMIT);
  const bypassCache = request.nextUrl.searchParams.get("refresh") === "1";

  try {
    const { data: rows, error } = await getCachedTransactions(userId, { bypassCache });
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
