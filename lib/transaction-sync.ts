import type { SupabaseClient } from "@supabase/supabase-js";
import { getPlaidClient } from "./plaid-client";
import { getSupabase } from "./supabase";
import { encryptToken, decryptToken } from "./encryption";
import { rateLimit } from "./rate-limit";

/** Min interval between Plaid /transactions/refresh calls per Item (Plaid also enforces daily limits). */
const PLAID_TX_REFRESH_WINDOW_MS = 120_000;
import OpenAI from "openai";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

interface EmbedRow {
  merchant_name?: string | null;
  raw_name?: string | null;
  primary_category?: string | null;
  detailed_category?: string | null;
  amount: number;
  date: string;
  payment_channel?: string | null;
  authorized_date?: string | null;
  city?: string | null;
  region?: string | null;
  counterparty_name?: string | null;
  website?: string | null;
}

function buildEmbedText(row: EmbedRow): string {
  const parts: string[] = [];

  const merchant = row.counterparty_name || row.merchant_name || row.raw_name || "";
  if (merchant) parts.push(merchant);

  const cat = (row.primary_category || "").replace(/_/g, " ").toLowerCase();
  const detail = (row.detailed_category || "").replace(/_/g, " ").toLowerCase();
  if (detail && detail !== cat) parts.push(`${cat} ${detail}`);
  else if (cat) parts.push(cat);

  parts.push(Math.abs(row.amount).toLocaleString("en-US", { style: "currency", currency: "USD" }));

  const d = new Date(row.authorized_date || row.date);
  if (!isNaN(d.getTime())) {
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    parts.push(`${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}`);
  } else {
    parts.push(row.date);
  }

  if (row.payment_channel) parts.push(row.payment_channel === "in store" ? "in-store purchase" : row.payment_channel === "online" ? "online purchase" : "");

  const loc = [row.city, row.region].filter(Boolean).join(", ");
  if (loc) parts.push(loc);

  if (row.website) parts.push(row.website);

  return parts.filter(Boolean).join(" | ").trim();
}

const EMBED_DIMENSIONS = 256;

async function embedBatch(texts: string[]): Promise<(number[] | null)[]> {
  if (!openai || texts.length === 0) return texts.map(() => null);
  try {
    const { data } = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: texts,
      dimensions: EMBED_DIMENSIONS,
    });
    const result: (number[] | null)[] = data.map((d: { embedding: number[] }) => d.embedding ?? null);
    while (result.length < texts.length) result.push(null);
    return result;
  } catch (e) {
    console.warn("[embed] batch failed:", e);
    return texts.map(() => null);
  }
}

export async function getPlaidTokenForUser(clerkUserId: string): Promise<string | null> {
  const db = getSupabase();
  const { data } = await db
    .from("plaid_items")
    .select("access_token")
    .eq("clerk_user_id", clerkUserId)
    .limit(1)
    .maybeSingle();
  return data?.access_token ? decryptToken(data.access_token) : null;
}

export async function getAllPlaidTokensForUser(clerkUserId: string): Promise<string[]> {
  const db = getSupabase();
  const { data } = await db
    .from("plaid_items")
    .select("access_token")
    .eq("clerk_user_id", clerkUserId);
  return (data ?? []).map((r: { access_token: string }) => decryptToken(r.access_token)).filter(Boolean);
}

/**
 * Returns the access token for the plaid_item most in need of re-auth.
 * Items with needs_reauth=true are ordered first so that update-mode link
 * tokens target the failing bank rather than always the first connected bank.
 */
export async function getReauthPriorityToken(clerkUserId: string): Promise<string | null> {
  const db = getSupabase();
  const { data } = await db
    .from("plaid_items")
    .select("access_token")
    .eq("clerk_user_id", clerkUserId)
    .order("needs_reauth", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.access_token ? decryptToken(data.access_token) : null;
}

export type PlaidItemInfo = { access_token: string; plaid_item_id: string; institution_name: string | null };
export async function getPlaidItemsForUser(clerkUserId: string): Promise<PlaidItemInfo[]> {
  const db = getSupabase();
  const { data } = await db
    .from("plaid_items")
    .select("access_token, plaid_item_id, institution_name")
    .eq("clerk_user_id", clerkUserId);
  return (data ?? []).map((item) => ({
    ...item,
    access_token: decryptToken((item as PlaidItemInfo).access_token),
  })) as PlaidItemInfo[];
}

export async function savePlaidToken(
  clerkUserId: string,
  accessToken: string,
  plaidItemId: string,
  institutionName?: string | null,
  institutionId?: string | null
) {
  const db = getSupabase();
  const row: Record<string, unknown> = {
    clerk_user_id: clerkUserId,
    access_token: encryptToken(accessToken),
    plaid_item_id: plaidItemId,
    institution_name: institutionName ?? null,
  };
  if (institutionId != null) row.institution_id = institutionId;
  // Prefer multi-bank: conflict on plaid_item_id (one row per connected bank).
  let { error } = await db.from("plaid_items").upsert(row, { onConflict: "plaid_item_id" });
  // If institution_id column doesn't exist, retry without it
  if (error && /column.*institution_id|does not exist/i.test(error.message) && institutionId != null) {
    delete row.institution_id;
    const retry = await db.from("plaid_items").upsert(row, { onConflict: "plaid_item_id" });
    error = retry.error;
  }
  if (!error) return;
  // Fallback: old schema had unique(clerk_user_id) only — one bank per user.
  // Error "no unique constraint" means migration not run; use old upsert target.
  if (/unique|constraint|conflict|on conflict/i.test(error.message)) {
    const { error: fallbackErr } = await db.from("plaid_items").upsert(row, { onConflict: "clerk_user_id" });
    if (fallbackErr) throw fallbackErr;
  } else {
    throw error;
  }
}

/** Build dedupe key: same (merchant, amount, date) = same real transaction across Items */
function dedupeKey(normalizedMerchant: string, amount: number, date: string): string {
  return `${normalizedMerchant}|${amount}|${date}`;
}

/** PostgREST default max rows per request — must paginate or linked receipts are invisible. */
const EMAIL_RECEIPT_PAGE = 1000;

/**
 * Load all email_receipts rows for a user with transaction_id set (paginated).
 */
export async function fetchAllEmailReceiptsLinkedForUser(
  db: SupabaseClient,
  clerkUserId: string,
  select: string
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let from = 0; ; from += EMAIL_RECEIPT_PAGE) {
    const { data, error } = await db
      .from("email_receipts")
      .select(select)
      .eq("clerk_user_id", clerkUserId)
      .not("transaction_id", "is", null)
      .order("id", { ascending: true })
      .range(from, from + EMAIL_RECEIPT_PAGE - 1);
    if (error) {
      console.error("[email_receipts] paginated fetch failed:", error.message);
      throw new Error(`email_receipts paginated fetch failed: ${error.message}`);
    }
    if (!data?.length) break;
    out.push(...(data as unknown as Record<string, unknown>[]));
    if (data.length < EMAIL_RECEIPT_PAGE) break;
  }
  return out;
}

const EMAIL_RECEIPT_TX_IN_CHUNK = 100;

/**
 * Set email_receipts.transaction_id to null for rows still pointing at these transaction UUIDs.
 * Scoped by clerk_user_id. Required before deleting transactions so email_receipts_transaction_id_fkey is not violated.
 */
export async function clearEmailReceiptLinksForTransactionIds(
  db: SupabaseClient,
  clerkUserId: string,
  transactionIds: string[]
): Promise<void> {
  if (transactionIds.length === 0) return;
  for (let i = 0; i < transactionIds.length; i += EMAIL_RECEIPT_TX_IN_CHUNK) {
    const chunk = transactionIds.slice(i, i + EMAIL_RECEIPT_TX_IN_CHUNK);
    const { error } = await db
      .from("email_receipts")
      .update({ transaction_id: null })
      .in("transaction_id", chunk)
      .eq("clerk_user_id", clerkUserId);
    if (error) {
      console.error("[email_receipts] clear transaction_id FK failed:", error.message);
      throw new Error(`Failed to clear email receipt FK links: ${error.message}`);
    }
  }
}

/**
 * Point receipt matches at the surviving duplicate row before deleting duplicate transactions.
 * Avoids FK violations on email_receipts_transaction_id_fkey and keeps receipts on the kept tx.
 * Always clears any remaining links to duplicate IDs afterward so deletes cannot fail if remap missed rows.
 */
export async function remapEmailReceiptsBeforeTxDedupeDelete(
  db: SupabaseClient,
  clerkUserId: string,
  duplicateIdToKeptId: Map<string, string>,
  duplicateIdsBeingDeleted: string[]
): Promise<void> {
  const byKept = new Map<string, string[]>();
  for (const dupId of duplicateIdsBeingDeleted) {
    const kept = duplicateIdToKeptId.get(dupId);
    if (!kept) continue;
    const arr = byKept.get(kept) ?? [];
    arr.push(dupId);
    byKept.set(kept, arr);
  }
  for (const [keptId, dupIds] of byKept) {
    for (let i = 0; i < dupIds.length; i += EMAIL_RECEIPT_TX_IN_CHUNK) {
      const chunk = dupIds.slice(i, i + EMAIL_RECEIPT_TX_IN_CHUNK);
      const { error } = await db
        .from("email_receipts")
        .update({ transaction_id: keptId })
        .in("transaction_id", chunk)
        .eq("clerk_user_id", clerkUserId);
      if (error) {
        console.warn("[transactions] receipt remap before dedupe delete failed:", error.message);
      }
    }
  }
  await clearEmailReceiptLinksForTransactionIds(db, clerkUserId, duplicateIdsBeingDeleted);
}

/**
 * Filter out rows that would duplicate an existing transaction.
 * Plaid returns different transaction_ids for the same real tx when the same bank
 * is linked multiple times (reconnect / duplicate Items). We skip inserting dupes.
 */
async function filterDuplicateTransactions<T extends { normalized_merchant: string; amount: number; date: string; plaid_transaction_id: string }>(
  db: Awaited<ReturnType<typeof getSupabase>>,
  clerkUserId: string,
  rows: T[]
): Promise<T[]> {
  if (rows.length === 0) return rows;

  // Query only the incoming plaid_transaction_ids to avoid unbounded full-table scans.
  // PostgREST caps unranged queries at 1000 rows; users with >1000 transactions would
  // silently get an incomplete duplicate filter using the old approach.
  const PAGE = 1000;
  const existingIds = new Set<string>();
  const incomingIds = rows.map((r) => r.plaid_transaction_id).filter(Boolean);
  for (let from = 0; from < incomingIds.length; from += PAGE) {
    const chunk = incomingIds.slice(from, from + PAGE);
    const { data: existingPage } = await db
      .from("transactions")
      .select("plaid_transaction_id")
      .eq("clerk_user_id", clerkUserId)
      .in("plaid_transaction_id", chunk);
    for (const r of existingPage ?? []) {
      if (r.plaid_transaction_id) existingIds.add(r.plaid_transaction_id as string);
    }
  }

  const seenInBatch = new Set<string>();
  return rows.filter((r) => {
    if (!r.plaid_transaction_id || existingIds.has(r.plaid_transaction_id)) return false;
    if (seenInBatch.has(r.plaid_transaction_id)) return false;
    seenInBatch.add(r.plaid_transaction_id);
    return true;
  });
}

async function syncSingleToken(
  clerkUserId: string,
  accessToken: string,
  plaidItemId: string,
  plaid: ReturnType<typeof getPlaidClient>,
  db: ReturnType<typeof getSupabase>,
  requestPlaidRefresh: boolean
): Promise<{ synced: number; removedIds: string[]; skipped: number }> {
  if (!plaid) return { synced: 0, removedIds: [], skipped: 0 };

  if (requestPlaidRefresh && plaidItemId) {
    const rl = rateLimit(`plaid-tx-refresh:${plaidItemId}`, 1, PLAID_TX_REFRESH_WINDOW_MS);
    if (rl.success) {
      try {
        await plaid.transactionsRefresh({ access_token: accessToken });
        console.log("[sync] transactionsRefresh requested", { plaidItemId });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn("[sync] transactionsRefresh failed (continuing with sync):", msg);
      }
    }
  }

  // Upsert accounts for this bank (plaid_item_id links to institution for display)
  let acctResp: Awaited<ReturnType<typeof plaid.accountsGet>>["data"] | null = null;
  try {
    const result = await plaid.accountsGet({ access_token: accessToken });
    acctResp = result.data;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[sync] accountsGet failed (skipping account upsert):", msg);
  }
  if (acctResp?.accounts && Array.isArray(acctResp.accounts)) {
    try {
      for (const acct of acctResp.accounts) {
        const bal = acct.balances as { current?: number; available?: number; iso_currency_code?: string } | undefined;
        const row: Record<string, unknown> = {
          clerk_user_id: clerkUserId,
          plaid_account_id: acct.account_id,
          plaid_item_id: plaidItemId,
          name: acct.name,
          type: acct.type,
          subtype: acct.subtype ?? null,
          mask: acct.mask ?? null,
        };
        try {
          await db.from("accounts").upsert(
            { ...row, balance_current: bal?.current ?? null, balance_available: bal?.available ?? null, iso_currency_code: bal?.iso_currency_code ?? "USD" },
            { onConflict: "plaid_account_id" }
          );
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          if (/column.*plaid_item_id|does not exist/i.test(errMsg)) {
            const { plaid_item_id: _pid, ...rowWithout } = row;
            await db.from("accounts").upsert(
              { ...rowWithout, balance_current: bal?.current ?? null, balance_available: bal?.available ?? null, iso_currency_code: bal?.iso_currency_code ?? "USD" },
              { onConflict: "plaid_account_id" }
            );
          } else {
            console.error("[sync] account upsert error:", errMsg, {
              clerkUserId,
              plaidAccountId: row.plaid_account_id,
            });
          }
        }
      }
    } catch (e) {
      console.error("[sync] account upsert failed (continuing with tx sync):", (e as Error).message);
    }
  } else {
    console.warn("[sync] accountsGet returned no accounts — skipping account upsert, continuing transaction sync", { clerkUserId, plaidItemId });
  }

  // Build account UUID map
  const { data: dbAccts } = await db
    .from("accounts")
    .select("id, plaid_account_id")
    .eq("clerk_user_id", clerkUserId);
  const acctMap = new Map(
    (dbAccts ?? []).map((a: { id: string; plaid_account_id: string }) => [a.plaid_account_id, a.id])
  );

  // Fetch all transactions from Plaid via cursor sync (per Plaid Transactions integration guide)
  const allAdded: Array<Record<string, unknown>> = [];
  const allModified: Array<Record<string, unknown>> = [];
  const allRemovedIds: string[] = [];
  let cursor: string | undefined;
  let lastGoodCursor: string | undefined;
  let hasMore = true;
  let mutationRetries = 0;
  const MAX_MUTATION_RETRIES = 3;
  while (hasMore) {
    lastGoodCursor = cursor;
    try {
      const resp = await plaid.transactionsSync({
        access_token: accessToken,
        cursor,
        count: 500,
      });
      allAdded.push(...(resp.data.added as unknown as Array<Record<string, unknown>>));
      allModified.push(...(resp.data.modified as unknown as Array<Record<string, unknown>>));
      const removed = resp.data.removed as unknown as Array<{ transaction_id?: string }>;
      if (Array.isArray(removed)) {
        for (const r of removed) {
          const id = typeof r === "string" ? r : r?.transaction_id;
          if (id) allRemovedIds.push(id);
        }
      }
      cursor = resp.data.next_cursor;
      hasMore = resp.data.has_more;
    } catch (e) {
      const err = e as { response?: { data?: { error_code?: string } } };
      if (err?.response?.data?.error_code === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION") {
        mutationRetries++;
        if (mutationRetries > MAX_MUTATION_RETRIES) {
          console.error("[sync] Exceeded max mutation retries", { plaidItemId });
          break;
        }
        cursor = lastGoodCursor;
        allAdded.length = 0;
        allModified.length = 0;
        allRemovedIds.length = 0;
        continue;
      }
      throw e;
    }
  }

  if (allAdded.length === 0 && allModified.length === 0 && allRemovedIds.length === 0) return { synced: 0, removedIds: [], skipped: 0 };

  const mapTxToRow = (tx: Record<string, unknown>) => {
    const merchant = (tx.merchant_name as string | null) ?? (tx.name as string) ?? "";
    const pfc = tx.personal_finance_category as { primary?: string; detailed?: string; confidence_level?: string } | null;
    const category = tx.category as string[] | null;
    const rawAmount = tx.amount as number | null | undefined;
    if (rawAmount === null || rawAmount === undefined || isNaN(Number(rawAmount))) {
      console.warn(`[sync] Skipping transaction ${tx.transaction_id} with invalid amount:`, rawAmount);
      return null;
    }
    const amount = rawAmount > 0 ? -Math.abs(rawAmount) : Math.abs(rawAmount);
    const location = tx.location as { city?: string; region?: string; postal_code?: string; country?: string } | null;
    const counterparties = tx.counterparties as Array<{ name?: string; type?: string; website?: string; logo_url?: string; entity_id?: string }> | null;
    const cp = counterparties?.[0];
    return {
      clerk_user_id: clerkUserId,
      plaid_transaction_id: tx.transaction_id as string,
      account_id: acctMap.get(tx.account_id as string) ?? null,
      date: tx.date as string,
      amount,
      iso_currency_code: (tx.iso_currency_code as string) ?? "USD",
      raw_name: (tx.name as string) ?? "",
      merchant_name: merchant,
      normalized_merchant: normalize(merchant),
      primary_category: pfc?.primary ?? category?.[0] ?? "OTHER",
      detailed_category: pfc?.detailed ?? category?.[1] ?? null,
      is_pending: (tx.pending as boolean) ?? false,
      payment_channel: (tx.payment_channel as string) ?? null,
      authorized_date: (tx.authorized_date as string) ?? null,
      city: location?.city ?? null,
      region: location?.region ?? null,
      postal_code: location?.postal_code ?? null,
      country: location?.country ?? null,
      merchant_entity_id: (tx.merchant_entity_id as string) ?? cp?.entity_id ?? null,
      website: (tx.website as string) ?? cp?.website ?? null,
      category_confidence: pfc?.confidence_level ?? null,
      pending_transaction_id: (tx.pending_transaction_id as string) ?? null,
      counterparty_name: cp?.name ?? null,
      counterparty_type: cp?.type ?? null,
      counterparty_website: cp?.website ?? null,
      counterparty_logo_url: cp?.logo_url ?? null,
    };
  };

  const addedRows = allAdded.map(mapTxToRow).filter((r): r is NonNullable<typeof r> => r !== null);
  const modifiedRows = allModified.map(mapTxToRow).filter((r): r is NonNullable<typeof r> => r !== null);

  const droppedCount = allAdded.length + allModified.length - addedRows.length - modifiedRows.length;
  if (droppedCount > 0) {
    console.error(`[sync] DROPPED ${droppedCount} transactions with invalid data (e.g. invalid amount) for user ${clerkUserId}`);
  }

  // Sync-time dedupe: only for ADDED transactions. Plaid can return same tx with different
  // IDs when same bank is linked multiple times (duplicate Items). Modified transactions
  // must always be upserted so pending->posted transitions and merchant name refinements
  // are applied.
  const filteredAdded = await filterDuplicateTransactions(db, clerkUserId, addedRows);
  const rowsToInsert = [...filteredAdded, ...modifiedRows];

  const BATCH = 100;
  let actualSynced = 0;
  for (let i = 0; i < rowsToInsert.length; i += BATCH) {
    const batch = rowsToInsert.slice(i, i + BATCH);
    const { error } = await db
      .from("transactions")
      .upsert(batch, { onConflict: "plaid_transaction_id" });
    if (error) {
      console.error("[sync] upsert error:", error.message);
    } else {
      actualSynced += batch.length;
    }
  }

  const skipped = addedRows.length - filteredAdded.length;
  if (skipped > 0) {
    console.log("[sync] skipped", skipped, "duplicate tx(s) for user", clerkUserId);
  }

  return { synced: actualSynced, removedIds: allRemovedIds, skipped };
}

export type SyncTransactionsOptions = {
  /**
   * Ask Plaid to pull the latest from the institution before /transactions/sync.
   * Use for user-driven sync (pull-to-refresh, POST); omit for webhooks to avoid refresh quotas.
   */
  requestPlaidRefresh?: boolean;
};

export async function syncTransactionsForUser(
  clerkUserId: string,
  options?: SyncTransactionsOptions
): Promise<{ synced: number; error?: string }> {
  const requestPlaidRefresh = options?.requestPlaidRefresh === true;
  const db = getSupabase();
  const accessTokens = await getAllPlaidTokensForUser(clerkUserId);
  if (accessTokens.length === 0) return { synced: 0, error: "No Plaid connection found for user" };

  const plaid = getPlaidClient();
  if (!plaid) return { synced: 0, error: "Plaid not configured" };

  const items = await getPlaidItemsForUser(clerkUserId);
  const tokenToItem = new Map(items.map((i) => [i.access_token, i]));

  let totalSynced = 0;
  let totalSkipped = 0;
  const allRemovedIds: string[] = [];
  const errors: string[] = [];

  for (const token of accessTokens) {
    const item = tokenToItem.get(token);
    const plaidItemId = item?.plaid_item_id ?? "";
    try {
      const { synced, removedIds, skipped } = await syncSingleToken(
        clerkUserId,
        token,
        plaidItemId,
        plaid,
        db,
        requestPlaidRefresh
      );
      totalSynced += synced;
      totalSkipped += skipped;
      allRemovedIds.push(...removedIds);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[sync] error syncing token:", msg);
      errors.push(msg);
    }
  }

  // Delete removed transactions across all banks (batch to avoid URL length limit)
  if (allRemovedIds.length > 0) {
    // Get internal UUIDs for the plaid_transaction_ids being removed
    const { data: toRemove } = await db
      .from("transactions")
      .select("id")
      .eq("clerk_user_id", clerkUserId)
      .in("plaid_transaction_id", allRemovedIds);

    const removedUuids = (toRemove ?? []).map(r => r.id as string);

    // Clean up subscription_transactions references first
    if (removedUuids.length > 0) {
      await db
        .from("subscription_transactions")
        .delete()
        .in("transaction_id", removedUuids);
    }

    // Plaid-removed rows are deleted outright (not merged); clear receipt FKs first
    await clearEmailReceiptLinksForTransactionIds(db, clerkUserId, removedUuids);

    // Now safe to delete transactions
    const BATCH = 100;
    for (let i = 0; i < allRemovedIds.length; i += BATCH) {
      const batch = allRemovedIds.slice(i, i + BATCH);
      const { error: delErr } = await db
        .from("transactions")
        .delete()
        .eq("clerk_user_id", clerkUserId)
        .in("plaid_transaction_id", batch);
      if (delErr) console.error("[sync] delete removed error:", delErr.message);
    }
  }

  // Post-sync cleanup: only run when we actually skipped dupes (multi-Item state).
  // Avoids full-scan on every sync once DB is clean. Plaid transaction_id is unique
  // per Item, but same bank linked multiple times = same tx with different IDs.
  if (totalSkipped > 0) {
    const deleted = await deleteDuplicateTransactionsForUser(db, clerkUserId);
    if (deleted > 0) {
      console.log("[sync] cleaned", deleted, "duplicate tx(s) for user", clerkUserId);
    }
  }

  // Post-sync: if Gmail is connected, scan for new receipts then match to transactions.
  // Scanning on every Plaid sync means enriched data is ready the moment a charge appears.
  if (totalSynced > 0) {
    try {
      const { data: gmailConn } = await db
        .from("gmail_connections")
        .select("id, last_scan_at")
        .eq("clerk_user_id", clerkUserId)
        .maybeSingle();
      if (gmailConn) {
        // Scan Gmail if last scan was > 5 minutes ago (avoids redundant scans on rapid refreshes)
        const lastScan = (gmailConn as { last_scan_at?: string | null }).last_scan_at;
        const minsSinceScan = lastScan
          ? (Date.now() - new Date(lastScan).getTime()) / 60_000
          : Infinity;
        if (minsSinceScan > 5) {
          try {
            const { scanGmailForReceipts } = await import("./receipt-parser");
            const scanResult = await scanGmailForReceipts(clerkUserId, 7, true, false);
            console.log(`[sync] Gmail scan: ${scanResult.inserted} new, ${scanResult.matched} matched for user ${clerkUserId}`);
          } catch (scanErr) {
            console.warn("[sync] Gmail scan failed (non-blocking):", scanErr);
          }
        }

        // Also match any older unmatched receipts against the new transactions
        const { matchReceiptsToTransactions } = await import("./receipt-matcher");
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const { data: unmatched } = await db
          .from("email_receipts")
          .select("id")
          .eq("clerk_user_id", clerkUserId)
          .is("transaction_id", null)
          .gte("parsed_at", thirtyDaysAgo.toISOString());
        if (unmatched && unmatched.length > 0) {
          const matched = await matchReceiptsToTransactions(clerkUserId, unmatched.map((r) => r.id));
          if (matched > 0) console.log(`[sync] auto-matched ${matched} receipts for user ${clerkUserId}`);
        }
      }
    } catch (err) {
      console.error("[sync] receipt scan/match failed (non-blocking):", err);
    }
  }

  return { synced: totalSynced, ...(totalSynced === 0 && errors.length > 0 ? { error: `Sync failed for ${errors.length} bank(s)` } : {}) };
}

/**
 * Full-scan dedupe: delete duplicate transactions for a user.
 * Keeps the first occurrence (by id) per (normalized_merchant, amount, date).
 * Skips rows referenced by split_transactions or subscription_transactions.
 * Receipt matches on duplicate rows are remapped to the kept row before delete.
 */
export async function deleteDuplicateTransactionsForUser(
  db: SupabaseClient,
  clerkUserId: string
): Promise<number> {
  const PAGE = 2000;
  let offset = 0;
  const seen = new Map<string, string>(); // key -> id to keep
  const idsToDelete: string[] = [];
  const duplicateIdToKeptId = new Map<string, string>();

  // Get user's transaction IDs to scope protection queries
  const { data: userTxs } = await db
    .from("transactions")
    .select("id")
    .eq("clerk_user_id", clerkUserId);
  const userTxIds = (userTxs ?? []).map((r) => r.id as string);

  const { data: protectedSplits } = await db
    .from("split_transactions")
    .select("transaction_id")
    .in("transaction_id", userTxIds);
  const { data: protectedSubTxs } = await db
    .from("subscription_transactions")
    .select("transaction_id")
    .in("transaction_id", userTxIds)
    .not("transaction_id", "is", null);
  const protectedIds = new Set(
    [
      ...(protectedSplits ?? []).map((r) => r.transaction_id as string),
      ...(protectedSubTxs ?? []).map((r) => r.transaction_id as string),
    ].filter(Boolean)
  );

  while (true) {
    const { data: rows } = await db
      .from("transactions")
      .select("id, normalized_merchant, amount, date, plaid_transaction_id")
      .eq("clerk_user_id", clerkUserId)
      .not("plaid_transaction_id", "like", "manual_%")
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);

    if (!rows || rows.length === 0) break;

    for (const r of rows) {
      const norm = ((r.normalized_merchant ?? "") as string).trim();
      const key = dedupeKey(norm, Number(r.amount), (r.date as string) ?? "");
      if (protectedIds.has(r.id as string)) continue;
      const keptId = seen.get(key);
      if (keptId === undefined) {
        seen.set(key, r.id as string);
      } else {
        const dupId = r.id as string;
        idsToDelete.push(dupId);
        duplicateIdToKeptId.set(dupId, keptId);
      }
    }

    offset += rows.length;
    if (rows.length < PAGE) break;
  }

  if (idsToDelete.length === 0) return 0;

  const BATCH = 100;
  for (let i = 0; i < idsToDelete.length; i += BATCH) {
    const batch = idsToDelete.slice(i, i + BATCH);
    await remapEmailReceiptsBeforeTxDedupeDelete(db, clerkUserId, duplicateIdToKeptId, batch);
    const { error } = await db
      .from("transactions")
      .delete()
      .eq("clerk_user_id", clerkUserId)
      .in("id", batch);
    if (error) {
      console.warn("[sync] dedupe delete batch failed:", error.message);
      return idsToDelete.length; // partial success
    }
  }
  return idsToDelete.length;
}

// ─── AI Category Enrichment ──────────────────────────────────────────────────
// Re-categorize transactions using an LLM instead of relying on Plaid's often
// inaccurate defaults (e.g. theScore as "GENERAL_SERVICES", gas as "OTHER").

const AI_CATEGORIES = [
  "FOOD_AND_DRINK", "GROCERIES", "COFFEE", "ALCOHOL", "FAST_FOOD",
  "ENTERTAINMENT", "GAMBLING", "STREAMING",
  "TRANSPORTATION", "GAS_AND_FUEL", "PARKING", "RIDESHARE",
  "TRAVEL",
  "SHOPPING", "CLOTHING", "ELECTRONICS",
  "PERSONAL_CARE", "HAIRCUT",
  "HEALTHCARE", "FITNESS",
  "RENT_AND_UTILITIES", "HOME_IMPROVEMENT",
  "SUBSCRIPTIONS",
  "CANNABIS",
  "EDUCATION",
  "INCOME", "TRANSFER_IN", "TRANSFER_OUT", "LOAN_PAYMENTS",
  "OTHER",
] as const;

const CATEGORIZE_BATCH = 30;

/** Parse LLM JSON; never throws. Returns null on truncated/invalid JSON. */
function safeParseCategoriesJson(raw: string): { categories?: unknown } | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    return JSON.parse(s) as { categories?: unknown };
  } catch {
    return null;
  }
}

interface TxForCategorization {
  id: string;
  merchant_name: string | null;
  raw_name: string | null;
  amount: number;
  primary_category: string | null;
}

async function categorizeBatch(
  txs: TxForCategorization[]
): Promise<Map<string, string>> {
  if (!openai || txs.length === 0) return new Map();

  const lines = txs.map((tx, i) => {
    const merchant = tx.merchant_name || tx.raw_name || "Unknown";
    const amt = Math.abs(tx.amount).toFixed(2);
    return `${i + 1}. "${merchant}" ($${amt})`;
  });

  const prompt = `Categorize each bank transaction into the most specific category from this list:
${AI_CATEGORIES.join(", ")}

Transactions:
${lines.join("\n")}

Return a JSON object: {"categories": ["CATEGORY_1", "CATEGORY_2", ...]}
The array MUST have exactly ${txs.length} elements, one per transaction, in the same order.
Pick the MOST SPECIFIC category that fits. Examples:
- Gas stations → GAS_AND_FUEL (not TRANSPORTATION)
- Sports betting apps (theScore, DraftKings, bet365) → GAMBLING (not ENTERTAINMENT)
- Barber shops, salons → HAIRCUT (not PERSONAL_CARE)
- Cannabis dispensaries → CANNABIS (not SHOPPING)
- Bars, liquor stores → ALCOHOL (not FOOD_AND_DRINK)
- Starbucks, Tim Hortons → COFFEE (not FOOD_AND_DRINK)
- Netflix, Spotify → STREAMING (not ENTERTAINMENT)
- Uber, Lyft → RIDESHARE (not TRANSPORTATION)
- McDonald's, Burger King → FAST_FOOD (not FOOD_AND_DRINK)
- Parking lots, ParkMobile → PARKING (not TRANSPORTATION)
- Gym, fitness → FITNESS (not PERSONAL_CARE)
- Amazon, Walmart (general) → SHOPPING
- Clothing stores → CLOTHING
Be precise. Do not explain.`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 500 + txs.length * 12,
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) return new Map();

    const parsed = safeParseCategoriesJson(raw);
    if (!parsed) return new Map();
    const cats = Array.isArray(parsed.categories) ? parsed.categories : null;
    if (!cats || cats.length !== txs.length) return new Map();

    const result = new Map<string, string>();
    const validSet = new Set<string>(AI_CATEGORIES);
    for (let i = 0; i < txs.length; i++) {
      const cat = typeof cats[i] === "string" ? cats[i] : null;
      if (cat && validSet.has(cat)) {
        result.set(txs[i].id, cat);
      }
    }
    return result;
  } catch (e) {
    console.warn("[categorize] batch failed:", e);
    return new Map();
  }
}

/**
 * Re-categorize transactions using AI. Processes transactions that have generic
 * Plaid categories or all transactions if forceAll is true.
 */
export async function enrichCategoriesForUser(
  clerkUserId: string,
  opts?: { forceAll?: boolean }
): Promise<number> {
  if (!openai) return 0;
  const db = getSupabase();

  // Fetch transactions to categorize
  let query = db
    .from("transactions")
    .select("id, merchant_name, raw_name, amount, primary_category")
    .eq("clerk_user_id", clerkUserId)
    .order("date", { ascending: false })
    .limit(2000);

  // Unless forceAll, only re-categorize poorly-tagged ones
  if (!opts?.forceAll) {
    query = query.in("primary_category", [
      "OTHER", "GENERAL_SERVICES", "GENERAL_MERCHANDISE",
      "TRANSFER_OUT", "TRANSFER_IN",
    ]);
  }

  const { data: rows, error } = await query;
  if (error || !rows?.length) return 0;

  const txs = rows as TxForCategorization[];
  let updated = 0;

  for (let i = 0; i < txs.length; i += CATEGORIZE_BATCH) {
    const batch = txs.slice(i, i + CATEGORIZE_BATCH);
    const categories = await categorizeBatch(batch);

    for (const [id, category] of categories) {
      const { error: updateErr } = await db
        .from("transactions")
        .update({ primary_category: category })
        .eq("id", id)
        .eq("clerk_user_id", clerkUserId);
      if (updateErr) {
        console.warn("[categorize] update failed for tx", id, ":", updateErr.message);
      } else {
        updated++;
      }
    }
  }

  console.log(`[categorize] enriched ${updated}/${txs.length} transactions for ${clerkUserId}`);
  return updated;
}

// ─── Rich Embedding for Search v2 ────────────────────────────────────────────
// Generates a natural-language document per transaction for the new
// `rich_embedding` column. The existing `buildEmbedText` / `embedding` column
// are NOT modified.

const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function formatDateHuman(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function buildRichEmbedText(
  tx: {
    merchant_name?: string | null;
    raw_name?: string | null;
    normalized_merchant?: string | null;
    primary_category?: string | null;
    detailed_category?: string | null;
    amount: number;
    date: string;
    is_pending?: boolean;
  },
  account?: {
    name?: string | null;
    subtype?: string | null;
    mask?: string | null;
  } | null,
): string {
  const merchant = tx.merchant_name || tx.raw_name || "Unknown";
  const absAmount = Math.abs(tx.amount).toFixed(2);
  const txType = tx.amount < 0 ? "purchase" : tx.amount > 0 ? "refund/credit" : "transaction";

  const parts: (string | null)[] = [
    `$${absAmount} ${txType} at ${merchant}`,
  ];

  const nm = tx.normalized_merchant;
  if (nm && nm !== merchant.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim()) {
    parts.push(`also known as ${nm}`);
  }

  parts.push(`on ${formatDateHuman(tx.date)}`);

  const primary = (tx.primary_category || "OTHER").replace(/_/g, " ");
  const detailed = tx.detailed_category ? tx.detailed_category.replace(/_/g, " ") : null;
  parts.push(detailed ? `Category: ${primary} > ${detailed}` : `Category: ${primary}`);

  if (account?.name) {
    const acctDesc = [account.name, account.subtype].filter(Boolean).join(" ");
    const ending = account.mask ? ` ending in ${account.mask}` : "";
    parts.push(`from ${acctDesc}${ending}`);
  }

  if (tx.is_pending) parts.push("(pending)");

  return parts.filter(Boolean).join(". ") + ".";
}

/**
 * Embed transactions into the NEW `rich_embedding` column.
 * Only processes rows where `rich_embedding IS NULL`.
 * Never touches the existing `embedding` column.
 */
export async function embedRichTransactionsForUser(clerkUserId: string): Promise<void> {
  if (!openai) return;
  const db = getSupabase();

  const { data: rows } = await db
    .from("transactions")
    .select("id, merchant_name, raw_name, normalized_merchant, primary_category, detailed_category, amount, date, is_pending, account_id")
    .eq("clerk_user_id", clerkUserId)
    .is("rich_embedding", null)
    .limit(1000);

  if (!rows || rows.length === 0) return;

  // Fetch accounts for this user to enrich embed text
  const { data: accounts } = await db
    .from("accounts")
    .select("id, name, subtype, mask")
    .eq("clerk_user_id", clerkUserId);
  const accountMap = new Map(
    (accounts ?? []).map((a: { id: string; name: string | null; subtype: string | null; mask: string | null }) => [a.id, a])
  );

  const EMBED_BATCH = 100;
  for (let i = 0; i < rows.length; i += EMBED_BATCH) {
    const batch = rows.slice(i, i + EMBED_BATCH) as Array<{
      id: string;
      merchant_name: string | null;
      raw_name: string | null;
      normalized_merchant: string | null;
      primary_category: string | null;
      detailed_category: string | null;
      amount: number;
      date: string;
      is_pending: boolean;
      account_id: string | null;
    }>;

    const texts = batch.map((t) => {
      const account = t.account_id ? accountMap.get(t.account_id) : null;
      return buildRichEmbedText(t, account ?? null);
    });

    const embeddings = await embedBatch(texts);
    for (let j = 0; j < batch.length; j++) {
      const emb = embeddings[j];
      if (emb) {
        await db
          .from("transactions")
          .update({
            rich_embedding: JSON.stringify(emb),
            embed_text: texts[j],
          })
          .eq("id", batch[j].id);
      }
    }
  }
  console.log(`[embed-rich] finished embedding ${rows.length} transactions for ${clerkUserId}`);
}

// Called async after exchange-token — does not block the HTTP response
export async function embedTransactionsForUser(clerkUserId: string): Promise<void> {
  if (!openai) return;
  const db = getSupabase();

  const { data: rows } = await db
    .from("transactions")
    .select("id, merchant_name, raw_name, primary_category, detailed_category, amount, date, payment_channel, authorized_date, city, region, counterparty_name, website")
    .eq("clerk_user_id", clerkUserId)
    .is("embedding", null)
    .limit(1000);

  if (!rows || rows.length === 0) return;

  const EMBED_BATCH = 100;
  for (let i = 0; i < rows.length; i += EMBED_BATCH) {
    const batch = rows.slice(i, i + EMBED_BATCH) as Array<EmbedRow & { id: string }>;
    const texts = batch.map((t) => buildEmbedText(t));
    const embeddings = await embedBatch(texts);
    for (let j = 0; j < batch.length; j++) {
      const emb = embeddings[j];
      if (emb) {
        await db
          .from("transactions")
          .update({ embedding: JSON.stringify(emb) })
          .eq("id", batch[j].id);
      }
    }
  }
  console.log(`[embed] finished embedding ${rows.length} transactions for ${clerkUserId}`);
}
