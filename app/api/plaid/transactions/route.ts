import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { cleanMerchantForDisplay } from "@/lib/merchant-display";
import { getEffectiveUserId } from "@/lib/demo";
import {
  needsLLMNormalization,
  normalizeMerchantsWithLLM,
} from "@/lib/merchant-normalize-llm";

export async function GET() {
  const effectiveUserId = await getEffectiveUserId();
  if (!effectiveUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getSupabase();
    const { data, error } = await db
      .from("transactions")
      .select(
        "id, plaid_transaction_id, merchant_name, raw_name, amount, date, primary_category, detailed_category, iso_currency_code, is_pending"
      )
      .eq("clerk_user_id", effectiveUserId)
      .order("date", { ascending: false })
      .limit(2000);

    if (error) throw error;

    // Exclude manual expenses (from Shared tab splits) — they belong in Shared, not main Transactions
    const bankOnly = (data ?? []).filter(
      (tx) => !String(tx.plaid_transaction_id || "").startsWith("manual_")
    );

    // Deduplicate: same merchant+amount+date can appear twice (sandbox vs production Plaid IDs)
    const seen = new Set<string>();
    const keptIds = new Set<string>();
    const deduped = bankOnly.filter((tx) => {
      const merchant = (tx.merchant_name || tx.raw_name || "").trim().toLowerCase();
      const amount = Number(tx.amount);
      const date = tx.date as string;
      const key = `${merchant}|${amount}|${date}`;
      if (seen.has(key)) return false;
      seen.add(key);
      keptIds.add(tx.id as string);
      return true;
    });

    // Actually delete duplicate rows from Supabase (first occurrence stays)
    // Don't delete tx that are in splits — they're referenced by split_transactions
    const { data: inSplits } = await db.from("split_transactions").select("transaction_id");
    const protectedIds = new Set((inSplits ?? []).map((r) => r.transaction_id as string));
    const idsToDelete = bankOnly
      .map((tx) => tx.id as string)
      .filter((id) => !keptIds.has(id) && !protectedIds.has(id));
    if (idsToDelete.length > 0) {
      await db.from("transactions").delete().in("id", idsToDelete);
    }

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

    // LLM normalization for long/weird descriptions (batched, cached)
    const llmCandidates = deduped.filter((tx) => {
      const raw = (tx.merchant_name || tx.raw_name || "Unknown") as string;
      const primary = (tx.primary_category ?? "OTHER") as string;
      return needsLLMNormalization(raw, primary);
    });
    const llmResults = await normalizeMerchantsWithLLM(
      llmCandidates.map((tx) => ({
        raw: (tx.merchant_name || tx.raw_name || "Unknown") as string,
        category: (tx.primary_category ?? "OTHER") as string,
      }))
    );

    const mapped = deduped.map((tx) => {
      const primary = (tx.primary_category ?? "OTHER") as string;
      const rawMerchant = (tx.merchant_name || tx.raw_name || "Unknown") as string;
      const merchant =
        llmResults.get(rawMerchant) ?? cleanMerchantForDisplay(rawMerchant, primary);
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
        isPending: Boolean(tx.is_pending),
      };
    });

    return NextResponse.json(mapped);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to get transactions";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Re-sync from Plaid on demand. Body: { fullResync?: true } to clear stale/sandbox tx first.
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getSupabase();

  // Always clear before sync so we never mix sandbox + production or accumulate duplicates
  {
    // Delete bank tx not in splits (keeps manual expenses + any split bank tx)
    const { data: inSplits } = await db
      .from("split_transactions")
      .select("transaction_id");
    const protectedIds = new Set(
      (inSplits ?? []).map((r) => r.transaction_id as string)
    );

    const { data: toDelete } = await db
      .from("transactions")
      .select("id, plaid_transaction_id")
      .eq("clerk_user_id", userId);

    const idsToDelete = (toDelete ?? [])
      .filter((r) => !String(r.plaid_transaction_id || "").startsWith("manual_"))
      .map((r) => r.id as string)
      .filter((id) => !protectedIds.has(id));

    if (idsToDelete.length > 0) {
      const { error: delErr } = await db
        .from("transactions")
        .delete()
        .in("id", idsToDelete);
      if (delErr) {
        console.error("[transactions] fullResync delete error:", delErr.message);
        return NextResponse.json({ error: "Failed to clear stale data" }, { status: 500 });
      }
      console.log(`[transactions] cleared ${idsToDelete.length} before sync for ${userId}`);
    }
  }

  const { syncTransactionsForUser, embedTransactionsForUser } = await import("@/lib/transaction-sync");
  const { synced, error } = await syncTransactionsForUser(userId);
  if (error) return NextResponse.json({ error }, { status: 500 });
  embedTransactionsForUser(userId).catch(() => {});
  const { detectSubscriptionsForUser, saveDetectedSubscriptions } = await import("@/lib/subscription-detect");
  const detected = await detectSubscriptionsForUser(userId);
  await saveDetectedSubscriptions(userId, detected);
  return NextResponse.json({ synced, detected: detected.length });
}
