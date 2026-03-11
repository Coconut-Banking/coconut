import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { cleanMerchantForDisplay } from "@/lib/merchant-display";
import { getEffectiveUserId } from "@/lib/demo";
import { CATEGORY_COLORS, MERCHANT_COLORS } from "@/lib/plaid-mappers";
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
        "id, plaid_transaction_id, account_id, merchant_name, raw_name, amount, date, primary_category, detailed_category, iso_currency_code, is_pending"
      )
      .eq("clerk_user_id", effectiveUserId)
      .order("date", { ascending: false })
      .order("id", { ascending: false })
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

    const accountIdToMask = new Map<string, string>();
    if (deduped.length > 0) {
      const acctIds = [...new Set((deduped as { account_id?: string }[]).map((t) => t.account_id).filter(Boolean))];
      if (acctIds.length > 0) {
        const { data: accts } = await db.from("accounts").select("id, plaid_account_id, name, mask").in("id", acctIds);
        for (const a of accts ?? []) {
          accountIdToMask.set(a.id, a.mask ?? "****");
          accountIdToMask.set(`name:${a.id}`, a.name ?? "");
          accountIdToMask.set(`plaid:${a.id}`, a.plaid_account_id);
        }
      }
    }

    // Load subscription merchants to flag recurring transactions
    const { data: activeSubs } = await db
      .from("subscriptions")
      .select("normalized_merchant")
      .eq("clerk_user_id", effectiveUserId)
      .eq("status", "active");
    const recurringMerchants = new Set(
      (activeSubs ?? []).map((s) => (s.normalized_merchant as string || "").toLowerCase()).filter(Boolean)
    );

    const mapped = deduped.map((tx) => {
      const primary = (tx.primary_category ?? "OTHER") as string;
      const rawMerchant = (tx.merchant_name || tx.raw_name || "Unknown") as string;
      const merchant =
        llmResults.get(rawMerchant) ?? cleanMerchantForDisplay(rawMerchant, primary);
      const aid = tx.account_id as string | undefined;
      const normalizedForRecurring = rawMerchant.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
      return {
        id: tx.plaid_transaction_id as string,
        dbId: tx.id as string,
        accountId: aid ?? null,
        accountMask: aid ? accountIdToMask.get(aid) ?? "****" : null,
        accountName: aid ? accountIdToMask.get(`name:${aid}`) ?? null : null,
        merchant,
        rawDescription: (tx.raw_name || "") as string,
        amount: tx.amount as number,
        category: primary.replace(/_/g, " "),
        categoryColor: CATEGORY_COLORS[primary] ?? "bg-gray-100 text-gray-700",
        date: tx.date as string,
        dateStr: fmtDate(tx.date as string),
        isRecurring: recurringMerchants.has(normalizedForRecurring),
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

  try {
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
  embedTransactionsForUser(userId).catch((e) => console.error("[transactions] embed:", e));
  const { detectSubscriptionsForUser, saveDetectedSubscriptions } = await import("@/lib/subscription-detect");
  const detected = await detectSubscriptionsForUser(userId);
  await saveDetectedSubscriptions(userId, detected);
  return NextResponse.json({ synced, detected: detected.length });
  } catch (err) {
    console.error("[transactions] sync error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Sync failed" }, { status: 500 });
  }
}
