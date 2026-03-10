import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { search } from "@/lib/search-engine";
import { chatWithContext } from "@/lib/openai";

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json();
    const message = (body.message as string)?.trim()?.slice(0, 2000);
    if (!message) {
      return NextResponse.json({ error: "message required" }, { status: 400 });
    }

    const db = getSupabase();

    const { data: subs } = await db
      .from("subscriptions")
      .select("merchant_name, amount, frequency")
      .eq("clerk_user_id", userId)
      .eq("status", "active");

    const subsSummary =
      (subs ?? []).length > 0
        ? (subs as { merchant_name: string; amount: number; frequency: string }[])
            .map((s) => `${s.merchant_name}: $${s.amount}/${s.frequency}`)
            .join(", ")
        : "No subscriptions.";

    const searchResult = await search(userId, message);
    const txs = searchResult.transactions;

    const transactions = txs.map((t) => ({
      id: t.plaid_transaction_id,
      merchant: t.merchant_name || t.raw_name || "Unknown",
      amount: t.amount,
      date: t.date,
      category: (t.primary_category ?? "OTHER").replace(/_/g, " "),
      rawDescription: t.raw_name ?? "",
    }));

    const reply = await chatWithContext(message, transactions, subsSummary);

    return NextResponse.json({ reply });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Chat failed" },
      { status: 500 }
    );
  }
}
