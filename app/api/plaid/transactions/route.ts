export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getSupabaseAdmin, getSupabaseForUser } from "@/lib/supabase";
import { cleanMerchantForDisplay } from "@/lib/merchant-display";
import { getEffectiveUserId } from "@/lib/demo";
import {
  getCachedSupabaseToken,
  loadClerkAuth,
} from "@/lib/auth";
import { CATEGORY_COLORS, MERCHANT_COLORS } from "@/lib/plaid-mappers";
import {
  merchantLlmResultKey,
  needsLLMNormalization,
  normalizeMerchantsWithLLM,
} from "@/lib/merchant-normalize-llm";
import { CACHE_TAGS } from "@/lib/cached-queries";
import {
  fetchAllEmailReceiptsLinkedForUser,
  remapEmailReceiptsBeforeTxDedupeDelete,
} from "@/lib/transaction-sync";

export async function GET(request: NextRequest) {
  const session = await loadClerkAuth();
  if (!session.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { userId: clerkUserId, getToken } = session;

  // Reuse session from loadClerkAuth — do not call auth() again inside getEffectiveUserId (Clerk 429).
  const effectiveUserId = await getEffectiveUserId({ userId: clerkUserId });
  if (!effectiveUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const bypassCache = request.nextUrl.searchParams.get("refresh") === "1";
  console.log("[pipeline:tx] GET start", { userId: effectiveUserId, refresh: bypassCache });

  try {
    const token = clerkUserId ? await getCachedSupabaseToken(getToken, clerkUserId) : null;
    const db = getSupabaseForUser(token) ?? getSupabaseAdmin();

    // Use direct RLS-backed query (avoid service-role cached query for security hardening)
    const { data, error } = await db
      .from("transactions")
      .select(
        "id, plaid_transaction_id, account_id, merchant_name, raw_name, normalized_merchant, merchant_display_llm, amount, date, primary_category, detailed_category, iso_currency_code, is_pending, pending_transaction_id, source, p2p_counterparty, p2p_note, p2p_platform, counterparty_logo_url"
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

    // If no cached transactions but user has a bank connection, return immediately with
    // X-Needs-Sync: 1 so the client fires a POST sync in the background.
    // This avoids blocking the GET for 3-6s on first load / cold cache.
    if (bankOnly.length === 0) {
      const { data: plaidItems } = await db
        .from("plaid_items")
        .select("id")
        .eq("clerk_user_id", effectiveUserId)
        .limit(1);
      const hasBankConnection = (plaidItems?.length ?? 0) > 0;
      const headers = new Headers({ "Cache-Control": "no-store, max-age=0" });
      if (hasBankConnection) headers.set("X-Needs-Sync", "1");
      return NextResponse.json([], { headers });
    }

    // ── Pending vs posted dedup ─────────────────────────────────────────────
    // Plaid sends a pending auth and a separate posted settlement for the same
    // charge. Dates often differ by 1-3 days and the raw_name changes.  Drop
    // pending rows whose posted counterpart already exists.
    {
      // 1. Exact match via pending_transaction_id (Plaid links posted → pending)
      const pendingPlaidIds = new Set(
        bankOnly
          .filter((tx) => tx.is_pending)
          .map((tx) => tx.plaid_transaction_id as string)
          .filter(Boolean)
      );
      const settledByPendingId = new Set(
        bankOnly
          .filter((tx) => !tx.is_pending && tx.pending_transaction_id)
          .map((tx) => tx.pending_transaction_id as string)
      );

      // 2. Fuzzy fallback: same normalized merchant + same amount, posted date
      //    within 4 days after the pending date.
      const postedByKey = new Map<string, number>();
      for (const tx of bankOnly) {
        if (tx.is_pending) continue;
        const norm = (tx.normalized_merchant || (tx.merchant_name as string || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim());
        const key = `${norm}|${tx.amount}`;
        const d = new Date(tx.date as string).getTime();
        postedByKey.set(key, Math.max(postedByKey.get(key) ?? 0, d));
      }

      bankOnly = bankOnly.filter((tx) => {
        if (!tx.is_pending) return true;
        const plaidId = tx.plaid_transaction_id as string;
        if (plaidId && settledByPendingId.has(plaidId)) return false;
        const norm = (tx.normalized_merchant || (tx.merchant_name as string || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim());
        const key = `${norm}|${tx.amount}`;
        const postedTime = postedByKey.get(key);
        if (postedTime !== undefined) {
          const pendingTime = new Date(tx.date as string).getTime();
          const dayDiff = (postedTime - pendingTime) / 86400000;
          if (dayDiff >= -1 && dayDiff <= 4) return false;
        }
        return true;
      });
    }

    // Deduplicate: same merchant+amount+date can appear twice (multi-Item or reconnect)
    const keptIds = new Set<string>();
    const duplicateIdToKeptId = new Map<string, string>();
    const keyToKeptId = new Map<string, string>();
    const deduped: typeof bankOnly = [];
    for (const tx of bankOnly) {
      const raw = (tx.merchant_name || tx.raw_name || "").trim().toLowerCase();
      const norm = tx.normalized_merchant ?? raw.replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
      const merchant = norm || raw;
      const amount = Number(tx.amount);
      const date = tx.date as string;
      const key = `${merchant}|${amount}|${date}`;
      const tid = tx.id as string;
      const existingKept = keyToKeptId.get(key);
      if (existingKept !== undefined) {
        duplicateIdToKeptId.set(tid, existingKept);
      } else {
        keyToKeptId.set(key, tid);
        keptIds.add(tid);
        deduped.push(tx);
      }
    }

    // All independent lookups in a single parallel batch.
    const adminDb = getSupabaseAdmin();
    const txIds = bankOnly.map((tx) => tx.id);
    const acctIds = [...new Set((deduped as { account_id?: string }[]).map((t) => t.account_id).filter(Boolean))];

    const [{ data: inSplits }, receiptRows, { data: inSubscriptions }, acctRows, { data: activeSubs }] = await Promise.all([
      db.from("split_transactions").select("transaction_id").in("transaction_id", txIds),
      fetchAllEmailReceiptsLinkedForUser(
        adminDb,
        effectiveUserId,
        "id, transaction_id, merchant, raw_subject, merchant_type, merchant_details"
      ),
      db.from("subscription_transactions").select("transaction_id").in("transaction_id", txIds),
      acctIds.length > 0
        ? db.from("accounts").select("id, plaid_account_id, name, nickname, mask").in("id", acctIds).then((r) => r.data ?? [])
        : Promise.resolve([] as { id: string; plaid_account_id: string; name: string; nickname: string | null; mask: string }[]),
      db.from("subscriptions").select("normalized_merchant").eq("clerk_user_id", effectiveUserId).eq("status", "active"),
    ]);

    const receiptMatchLineByTxId = new Map<string, string>();
    const receiptIdByTxId = new Map<string, string>();
    for (const r of receiptRows) {
      const tid = r.transaction_id as string | null;
      if (!tid) continue;
      receiptIdByTxId.set(tid, r.id as string);
      const merchant = (r.merchant as string | null | undefined)?.trim();
      const subj = (r.raw_subject as string | null | undefined)?.trim();
      const details = r.merchant_details as Record<string, unknown> | null;
      const mType = r.merchant_type as string | null;

      let line = merchant || (subj ? subj.slice(0, 72) : "") || "Email receipt";
      if (mType === "rideshare" && details?.pickup && details?.dropoff) {
        line = `${merchant}: ${details.pickup} → ${details.dropoff}`;
      } else if (mType === "food_delivery" && details?.restaurant_name) {
        line = `${merchant} — ${details.restaurant_name}`;
      } else if (mType === "saas" && details?.plan_name) {
        line = `${merchant} ${details.plan_name}`;
      }
      if (line.length > 80) line = line.slice(0, 78) + "…";
      receiptMatchLineByTxId.set(tid, line);
    }
    const receiptTxIds = new Set(receiptMatchLineByTxId.keys());
    const splitTxIds = new Set(
      (inSplits ?? []).map((r) => r.transaction_id as string).filter(Boolean)
    );

    // Remap receipt maps for duplicates (in-memory only — fast)
    for (const [dupId, keptId] of duplicateIdToKeptId) {
      if (receiptMatchLineByTxId.has(dupId)) {
        receiptMatchLineByTxId.set(keptId, receiptMatchLineByTxId.get(dupId)!);
        receiptMatchLineByTxId.delete(dupId);
      }
      if (receiptIdByTxId.has(dupId)) {
        receiptIdByTxId.set(keptId, receiptIdByTxId.get(dupId)!);
        receiptIdByTxId.delete(dupId);
      }
    }

    // Fire-and-forget: delete duplicate DB rows in the background
    const protectedIds = new Set(
      [
        ...(inSplits ?? []).map((r) => r.transaction_id as string),
        ...(inSubscriptions ?? []).map((r) => r.transaction_id as string),
      ].filter(Boolean)
    );
    const idsToDelete = bankOnly
      .map((tx) => tx.id as string)
      .filter((id) => !keptIds.has(id) && !protectedIds.has(id));
    if (idsToDelete.length > 0) {
      const uid = effectiveUserId;
      const dupMap = duplicateIdToKeptId;
      void (async () => {
        try {
          const bgAdmin = getSupabaseAdmin();
          const DEDUPE_BATCH = 100;
          for (let i = 0; i < idsToDelete.length; i += DEDUPE_BATCH) {
            const batch = idsToDelete.slice(i, i + DEDUPE_BATCH);
            await remapEmailReceiptsBeforeTxDedupeDelete(bgAdmin, uid, dupMap, batch);
            const { error: delErr } = await bgAdmin
              .from("transactions")
              .delete()
              .eq("clerk_user_id", uid)
              .in("id", batch);
            if (delErr) console.warn("[transactions] dedupe delete failed:", delErr.message);
          }
          try { revalidateTag(CACHE_TAGS.transactions(uid), "max"); } catch { /* ok */ }
        } catch (e) {
          console.warn("[transactions] background dedupe failed:", e);
        }
      })();
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

    // LLM normalization: fire-and-forget
    {
      const llmCandidates = deduped.filter((tx) => {
        if ((tx.merchant_display_llm as string | null)?.trim()) return false;
        const raw = (tx.merchant_name || tx.raw_name || "Unknown") as string;
        const primary = (tx.primary_category ?? "OTHER") as string;
        return needsLLMNormalization(raw, primary);
      });
      if (llmCandidates.length > 0) {
        const seenLlmKey = new Set<string>();
        const llmItems: Array<{ raw: string; category: string }> = [];
        const llmTxSnapshot: Array<{ id: string; raw: string; category: string }> = [];
        for (const tx of llmCandidates) {
          const raw = (tx.merchant_name || tx.raw_name || "Unknown") as string;
          const category = (tx.primary_category ?? "OTHER") as string;
          const k = merchantLlmResultKey(raw, category);
          llmTxSnapshot.push({ id: tx.id as string, raw, category });
          if (!seenLlmKey.has(k)) {
            seenLlmKey.add(k);
            llmItems.push({ raw, category });
          }
        }
        const uid = effectiveUserId;
        normalizeMerchantsWithLLM(llmItems).then(async (llmResults) => {
          if (llmResults.size === 0) return;
          const adminDbBg = getSupabaseAdmin();
          const toPersist: { id: string; value: string }[] = [];
          for (const snap of llmTxSnapshot) {
            const n = llmResults.get(merchantLlmResultKey(snap.raw, snap.category));
            if (!n) continue;
            const trimmed = n.slice(0, 200).trim();
            if (!trimmed || trimmed === snap.raw) continue;
            toPersist.push({ id: snap.id, value: trimmed });
          }
          const CHUNK = 40;
          const chunkPromises: Promise<unknown>[] = [];
          for (let i = 0; i < toPersist.length; i += CHUNK) {
            const chunk = toPersist.slice(i, i + CHUNK);
            chunkPromises.push(
              Promise.all(
                chunk.map((u) =>
                  adminDbBg
                    .from("transactions")
                    .update({ merchant_display_llm: u.value })
                    .eq("id", u.id)
                    .eq("clerk_user_id", uid)
                )
              )
            );
          }
          await Promise.all(chunkPromises);
        }).catch((e) => console.warn("[transactions] background LLM failed:", e));
      }
    }
    const accountIdToMask = new Map<string, string>();
    for (const a of acctRows) {
      accountIdToMask.set(a.id, a.mask ?? "****");
      accountIdToMask.set(`name:${a.id}`, (a as { nickname?: string | null }).nickname || a.name || "");
      accountIdToMask.set(`plaid:${a.id}`, a.plaid_account_id);
    }
    const recurringMerchants = new Set(
      (activeSubs ?? []).map((s) => (s.normalized_merchant as string || "").toLowerCase()).filter(Boolean)
    );

    const mapped = deduped.map((tx) => {
      const primary = (tx.primary_category ?? "OTHER") as string;
      const rawMerchant = (tx.merchant_name || tx.raw_name || "Unknown") as string;
      const storedLlm = (tx.merchant_display_llm as string | null)?.trim() ?? "";
      const merchant = storedLlm || cleanMerchantForDisplay(rawMerchant, primary);
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
        source: (tx.source as string) || undefined,
        p2pCounterparty: (tx.p2p_counterparty as string) || undefined,
        p2pNote: (tx.p2p_note as string) || undefined,
        p2pPlatform: (tx.p2p_platform as string) || undefined,
        hasReceipt: receiptTxIds.has(tx.id as string),
        receipt_id: receiptIdByTxId.get(tx.id as string) ?? null,
        receiptMatchLine: receiptMatchLineByTxId.get(tx.id as string) ?? undefined,
        alreadySplit: splitTxIds.has(tx.id as string),
        logoUrl: (tx as Record<string, unknown>).counterparty_logo_url as string | null ?? null,
      };
    });

    const receiptCount = mapped.filter((t) => t.hasReceipt).length;
    console.log("[pipeline:tx] GET output", { count: mapped.length, withReceipt: receiptCount, deduped: idsToDelete.length });
    return NextResponse.json(mapped, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (err) {
    console.error("[pipeline:tx] GET error:", err);
    return NextResponse.json({ error: "Failed to load transactions" }, { status: 500 });
  }
}

// Re-sync from Plaid on demand. Body: { fullResync?: true } to clear stale/sandbox tx first.
export async function POST() {
  const session = await loadClerkAuth();
  if (!session.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const effectiveUserId = await getEffectiveUserId({ userId: session.userId });
  if (!effectiveUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { syncTransactionsForUser, embedTransactionsForUser, embedRichTransactionsForUser, enrichCategoriesForUser } = await import("@/lib/transaction-sync");
    const { synced, error } = await syncTransactionsForUser(effectiveUserId);
    if (error) {
      const isUserError =
        /no plaid connection/i.test(error) || /not configured/i.test(error);
      return NextResponse.json({ error }, { status: isUserError ? 400 : 500 });
    }

    revalidateTag(CACHE_TAGS.transactions(effectiveUserId), "max");

    // Fire-and-forget heavy background tasks so the POST returns quickly.
    // These tasks are non-critical for the sync response.
    embedTransactionsForUser(effectiveUserId).catch((e) => console.error("[transactions] embed:", e));
    embedRichTransactionsForUser(effectiveUserId).catch((e) => console.error("[transactions] rich-embed:", e));
    enrichCategoriesForUser(effectiveUserId).catch((e) => console.error("[transactions] categorize:", e));
    import("@/lib/subscription-detect")
      .then(async ({ detectSubscriptionsForUser, saveDetectedSubscriptions }) => {
        const subs = await detectSubscriptionsForUser(effectiveUserId);
        await saveDetectedSubscriptions(effectiveUserId, subs);
      })
      .catch((e) => console.warn("[transactions] subscription detect failed:", e instanceof Error ? e.message : e));

    return NextResponse.json({ synced });
  } catch (err) {
    console.error("[transactions] sync error:", err);
    return NextResponse.json(
      { error: "Sync failed" },
      { status: 500 }
    );
  }
}
