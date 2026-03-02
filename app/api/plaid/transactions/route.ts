import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const db = getSupabase();
    const { data, error } = await db
      .from("transactions")
      .select(
        "id, plaid_transaction_id, merchant_name, raw_name, amount, date, primary_category, detailed_category, iso_currency_code, is_pending"
      )
      .eq("clerk_user_id", userId)
      .order("date", { ascending: false })
      .limit(500);

    if (error) throw error;

    // Map to UI shape (reuse existing mapper logic inline)
    const CATEGORY_COLORS: Record<string, string> = {
      ENTERTAINMENT: "bg-purple-100 text-purple-700",
      RESTAURANTS: "bg-orange-100 text-orange-700",
      GROCERIES: "bg-emerald-100 text-emerald-700",
      TRAVEL: "bg-cyan-100 text-cyan-700",
      TRANSPORTATION: "bg-blue-100 text-blue-700",
      SHOPPING: "bg-amber-100 text-amber-700",
      GENERAL_MERCHANDISE: "bg-amber-100 text-amber-700",
      UTILITIES: "bg-gray-100 text-gray-700",
      RENT_AND_UTILITIES: "bg-gray-100 text-gray-700",
      HEALTHCARE: "bg-pink-100 text-pink-700",
      FITNESS: "bg-pink-100 text-pink-700",
      SUBSCRIPTIONS: "bg-purple-100 text-purple-700",
      PERSONAL_CARE: "bg-indigo-100 text-indigo-700",
      GENERAL_SERVICES: "bg-slate-100 text-slate-700",
      FOOD_AND_DRINK: "bg-orange-100 text-orange-700",
      HOME_IMPROVEMENT: "bg-teal-100 text-teal-700",
    };

    const MERCHANT_COLORS = [
      "#E50914", "#1DB954", "#00674B", "#FF9900", "#003366", "#7BB848", "#555555",
      "#4A6CF7", "#E8507A", "#F59E0B", "#10A37F", "#FF5A5F", "#1A1A1A", "#4A90D9",
    ];

    function hashColor(str: string): string {
      let h = 0;
      for (let i = 0; i < str.length; i++) h = (h << 5) - h + str.charCodeAt(i);
      return MERCHANT_COLORS[Math.abs(h) % MERCHANT_COLORS.length];
    }

    function fmtDate(dateStr: string): string {
      const d = new Date(dateStr + "T12:00:00");
      const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      return `${months[d.getMonth()]} ${d.getDate()}`;
    }

    const mapped = (data ?? []).map((tx) => {
      const primary = (tx.primary_category ?? "OTHER") as string;
      const merchant = (tx.merchant_name || tx.raw_name || "Unknown") as string;
      return {
        id: tx.plaid_transaction_id as string,
        dbId: tx.id as string,
        merchant,
        rawDescription: (tx.raw_name || "") as string,
        amount: tx.amount as number,
        category: primary.replace(/_/g, " "),
        categoryColor: CATEGORY_COLORS[primary] ?? "bg-gray-100 text-gray-700",
        date: tx.date as string,
        dateStr: fmtDate(tx.date as string),
        isRecurring: false,
        hasSplitSuggestion: false,
        merchantColor: hashColor(merchant),
      };
    });

    return NextResponse.json(mapped);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to get transactions";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Re-sync from Plaid on demand
export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { syncTransactionsForUser, embedTransactionsForUser } = await import("@/lib/transaction-sync");
  const { synced, error } = await syncTransactionsForUser(userId);
  embedTransactionsForUser(userId).catch(() => {});
  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json({ synced });
}
