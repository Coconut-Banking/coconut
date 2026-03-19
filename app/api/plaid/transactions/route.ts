import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin, getSupabaseForUser } from "@/lib/supabase";
import { cleanMerchantForDisplay } from "@/lib/merchant-display";
import { getEffectiveUserId } from "@/lib/demo";
import { CATEGORY_COLORS, MERCHANT_COLORS } from "@/lib/plaid-mappers";
import { rateLimit } from "@/lib/rate-limit";
import {
  needsLLMNormalization,
  normalizeMerchantsWithLLM,
} from "@/lib/merchant-normalize-llm";
import { CACHE_TAGS } from "@/lib/cached-queries";

export async function GET(request: NextRequest) {
  const { userId: clerkUserId, getToken } = await auth();
  const effectiveUserId = await getEffectiveUserId();
  if (!effectiveUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const bypassCache = request.nextUrl.searchParams.get("refresh") === "1";
  console.log("[pipeline:tx] GET start", { userId: effectiveUserId, refresh: bypassCache });

  try {
    const token = clerkUserId ? await getToken({ template: "supabase" }) : null;
    const db = getSupabaseForUser(token) ?? getSupabaseAdmin();

    // Use direct RLS-backed query (avoid service-role cached query for security hardening)
    const { data, error } = await db
      .from("transactions")
      .select(
        "id, plaid_transaction_id, account_id, merchant_name, raw_name, normalized_merchant, amount, date, primary_category, detailed_category, iso_currency_code, is_pending"
      )
      .eq("clerk_user_id", effectiveUserId)
      .order("date", { ascending: false })
      .order("id", { ascending: false })
      .limit(2000);

    if (error) throw new Error(error.message);

    // Exclude manual expenses (from Shared tab splits) — they belong in Shared, not main Transactions
    let bankOnly = (data ?? []).filter(
      (tx) => !String(tx.plaid_transaction_id || "").startsWith("manual_")
    );

    // Direct mitigation: if connected account exists but local table is empty, trigger one sync-on-read.
    if (bankOnly.length === 0) {
      const rl = rateLimit(`plaid-sync-on-read:${effectiveUserId}`, 1, 90_000);
      if (rl.success) {
        try {
          const { syncTransactionsForUser } = await import("@/lib/transaction-sync");
          const synced = await syncTransactionsForUser(effectiveUserId);
          console.log("[transactions] sync-on-read for", effectiveUserId, ":", synced);
          try {
            revalidateTag(CACHE_TAGS.transactions(effectiveUserId), "max");
          } catch (revalErr) {
            console.warn("[transactions] revalidateTag failed:", revalErr);
          }
          const fresh = await db
            .from("transactions")
            .select(
              "id, plaid_transaction_id, account_id, merchant_name, raw_name, normalized_merchant, amount, date, primary_category, detailed_category, iso_currency_code, is_pending"
            )
            .eq("clerk_user_id", effectiveUserId)
            .order("date", { ascending: false })
            .order("id", { ascending: false })
            .limit(2000);
          if (fresh.error) throw new Error(fresh.error.message);
          const freshData = fresh.data;
          bankOnly = (freshData ?? []).filter(
            (tx) => !String(tx.plaid_transaction_id || "").startsWith("manual_")
          );
        } catch (e) {
          console.warn("[transactions] sync-on-read failed:", e);
        }
      }
    }

    // Deduplicate: same merchant+amount+date can appear twice (multi-Item or reconnect)
    const seen = new Set<string>();
    const keptIds = new Set<string>();
    const deduped = bankOnly.filter((tx) => {
      const raw = (tx.merchant_name || tx.raw_name || "").trim().toLowerCase();
      const norm = tx.normalized_merchant ?? raw.replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
      const merchant = norm || raw;
      const amount = Number(tx.amount);
      const date = tx.date as string;
      const key = `${merchant}|${amount}|${date}`;
      if (seen.has(key)) return false;
      seen.add(key);
      keptIds.add(tx.id as string);
      return true;
    });

    // Actually delete duplicate rows from Supabase (first occurrence stays)
    // Don't delete tx that are in splits, email_receipts, or subscriptions — they're referenced by FK
    const { data: inSplits } = await db.from("split_transactions").select("transaction_id").in("transaction_id", bankOnly.map(tx => tx.id));
    const { data: inReceipts } = await db.from("email_receipts").select("transaction_id").not("transaction_id", "is", null).eq("clerk_user_id", effectiveUserId);
    const { data: inSubscriptions } = await db.from("subscription_transactions").select("transaction_id");
    const protectedIds = new Set([
      ...(inSplits ?? []).map((r) => r.transaction_id as string),
      ...(inReceipts ?? []).map((r) => r.transaction_id as string),
      ...(inSubscriptions ?? []).map((r) => r.transaction_id as string),
    ].filter(Boolean));
    const idsToDelete = bankOnly
      .map((tx) => tx.id as string)
      .filter((id) => !keptIds.has(id) && !protectedIds.has(id));
    if (idsToDelete.length > 0) {
      const DEDUPE_BATCH = 100;
      for (let i = 0; i < idsToDelete.length; i += DEDUPE_BATCH) {
        const batch = idsToDelete.slice(i, i + DEDUPE_BATCH);
        const { error: delErr } = await db.from("transactions").delete().in("id", batch);
        if (delErr) console.warn("[transactions] dedupe delete failed:", delErr.message);
      }
      try {
        revalidateTag(CACHE_TAGS.transactions(effectiveUserId), "max");
      } catch (e) {
        console.warn("[transactions] revalidateTag after dedupe failed:", e);
      }
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
        isoCurrencyCode: (tx.iso_currency_code as string) || "USD",
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

    console.log("[pipeline:tx] GET output", { count: mapped.length });
    return NextResponse.json(mapped);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[pipeline:tx] GET error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Re-sync from Plaid on demand. Body: { fullResync?: true } to clear stale/sandbox tx first.
export async function POST() {
  const effectiveUserId = await getEffectiveUserId();
  if (!effectiveUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    // Sync first, THEN clear stale data only if sync succeeds.
    // Previously we cleared before sync, which destroyed data when Plaid tokens failed.
    const { syncTransactionsForUser, embedTransactionsForUser, embedRichTransactionsForUser, enrichCategoriesForUser } = await import("@/lib/transaction-sync");
    const { synced, error } = await syncTransactionsForUser(effectiveUserId);
    if (error) return NextResponse.json({ error }, { status: 500 });

    revalidateTag(CACHE_TAGS.transactions(effectiveUserId), "max");
    embedTransactionsForUser(effectiveUserId).catch((e) => console.error("[transactions] embed:", e));
    embedRichTransactionsForUser(effectiveUserId).catch((e) => console.error("[transactions] rich-embed:", e));
    enrichCategoriesForUser(effectiveUserId).catch((e) => console.error("[transactions] categorize:", e));

    let detected = 0;
    try {
      const { detectSubscriptionsForUser, saveDetectedSubscriptions } = await import("@/lib/subscription-detect");
      const subs = await detectSubscriptionsForUser(effectiveUserId);
      await saveDetectedSubscriptions(effectiveUserId, subs);
      detected = subs.length;
    } catch (e) {
      console.warn("[transactions] subscription detect failed:", e instanceof Error ? e.message : e);
    }

    return NextResponse.json({ synced, detected });
  } catch (err) {
    console.error("[transactions] sync error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 }
    );
  }
}
