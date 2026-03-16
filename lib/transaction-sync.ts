import { getPlaidClient } from "./plaid-client";
import { getSupabase } from "./supabase";
import OpenAI from "openai";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

function buildEmbedText(row: {
  merchant_name?: string | null;
  raw_name?: string | null;
  primary_category?: string | null;
  amount: number;
  date: string;
}): string {
  const merchant = row.merchant_name || row.raw_name || "";
  const category = (row.primary_category || "").replace(/_/g, " ").toLowerCase();
  return `${merchant} ${category} ${Math.abs(row.amount).toLocaleString("en-US", { style: "currency", currency: "USD" })} ${row.date}`.trim();
}

async function embedBatch(texts: string[]): Promise<(number[] | null)[]> {
  if (!openai || texts.length === 0) return texts.map(() => null);
  try {
    const { data } = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: texts,
    });
    return data.map((d) => d.embedding);
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
  return data?.access_token ?? null;
}

export async function getAllPlaidTokensForUser(clerkUserId: string): Promise<string[]> {
  const db = getSupabase();
  const { data } = await db
    .from("plaid_items")
    .select("access_token")
    .eq("clerk_user_id", clerkUserId);
  return (data ?? []).map((r: { access_token: string }) => r.access_token).filter(Boolean);
}

export type PlaidItemInfo = { access_token: string; plaid_item_id: string; institution_name: string | null };
export async function getPlaidItemsForUser(clerkUserId: string): Promise<PlaidItemInfo[]> {
  const db = getSupabase();
  const { data } = await db
    .from("plaid_items")
    .select("access_token, plaid_item_id, institution_name")
    .eq("clerk_user_id", clerkUserId);
  return (data ?? []) as PlaidItemInfo[];
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
    access_token: accessToken,
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

/**
 * Filter out rows that would duplicate an existing transaction.
 * Plaid returns different transaction_ids for the same real tx when the same bank
 * is linked multiple times (reconnect / duplicate Items). We skip inserting dupes.
 */
async function filterDuplicateTransactions<T extends { normalized_merchant: string; amount: number; date: string }>(
  db: Awaited<ReturnType<typeof getSupabase>>,
  clerkUserId: string,
  rows: T[]
): Promise<T[]> {
  if (rows.length === 0) return rows;

  const keys = rows.map((r) => dedupeKey(r.normalized_merchant, r.amount, r.date));
  const uniqueKeys = [...new Set(keys)];

  // Fetch existing (normalized_merchant, amount, date) for this user from DB
  const { data: existing } = await db
    .from("transactions")
    .select("normalized_merchant, amount, date")
    .eq("clerk_user_id", clerkUserId)
    .not("plaid_transaction_id", "like", "manual_%");

  const existingKeys = new Set(
    (existing ?? []).map((r) =>
      dedupeKey((r.normalized_merchant ?? "").trim(), Number(r.amount), (r.date as string) ?? "")
    )
  );

  const seenInBatch = new Set<string>();
  return rows.filter((r) => {
    const key = dedupeKey(r.normalized_merchant, r.amount, r.date);
    if (existingKeys.has(key)) return false;
    if (seenInBatch.has(key)) return false;
    seenInBatch.add(key);
    return true;
  });
}

async function syncSingleToken(
  clerkUserId: string,
  accessToken: string,
  plaidItemId: string,
  plaid: ReturnType<typeof getPlaidClient>,
  db: ReturnType<typeof getSupabase>
): Promise<{ synced: number; removedIds: string[]; skipped: number }> {
  if (!plaid) return { synced: 0, removedIds: [], skipped: 0 };

  // Upsert accounts for this bank (plaid_item_id links to institution for display)
  const { data: acctResp } = await plaid.accountsGet({ access_token: accessToken });
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
      const errMsg = (e as Error).message ?? "";
      if (/column.*plaid_item_id|does not exist/i.test(errMsg)) {
        const { plaid_item_id: _pid, ...rowWithout } = row;
        await db.from("accounts").upsert(
          { ...rowWithout, balance_current: bal?.current ?? null, balance_available: bal?.available ?? null, iso_currency_code: bal?.iso_currency_code ?? "USD" },
          { onConflict: "plaid_account_id" }
        );
      } else {
        await db.from("accounts").upsert(row, { onConflict: "plaid_account_id" });
      }
    }
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
        cursor = lastGoodCursor;
        continue;
      }
      throw e;
    }
  }

  const allTxs = [...allAdded, ...allModified];
  if (allTxs.length === 0 && allRemovedIds.length === 0) return { synced: 0, removedIds: [], skipped: 0 };

  const rows = allTxs.map((tx) => {
    const merchant = (tx.merchant_name as string | null) ?? (tx.name as string) ?? "";
    const pfc = tx.personal_finance_category as { primary?: string; detailed?: string } | null;
    const category = tx.category as string[] | null;
    const rawAmount = tx.amount as number;
    const amount = rawAmount > 0 ? -Math.abs(rawAmount) : Math.abs(rawAmount);
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
    };
  });

  // Sync-time dedupe: Plaid can return same tx with different IDs when same bank is linked
  // multiple times (duplicate Items). Skip inserting rows that would duplicate existing
  // (normalized_merchant, amount, date) for this user.
  const rowsToInsert = await filterDuplicateTransactions(db, clerkUserId, rows);

  const BATCH = 100;
  for (let i = 0; i < rowsToInsert.length; i += BATCH) {
    const { error } = await db
      .from("transactions")
      .upsert(rowsToInsert.slice(i, i + BATCH), { onConflict: "plaid_transaction_id" });
    if (error) console.error("[sync] upsert error:", error.message);
  }

  const skipped = rows.length - rowsToInsert.length;
  if (skipped > 0) {
    console.log("[sync] skipped", skipped, "duplicate tx(s) for user", clerkUserId);
  }

  return { synced: rowsToInsert.length, removedIds: allRemovedIds, skipped };
}

export async function syncTransactionsForUser(
  clerkUserId: string
): Promise<{ synced: number; error?: string }> {
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

  for (const token of accessTokens) {
    const item = tokenToItem.get(token);
    const plaidItemId = item?.plaid_item_id ?? "";
    try {
      const { synced, removedIds, skipped } = await syncSingleToken(clerkUserId, token, plaidItemId, plaid, db);
      totalSynced += synced;
      totalSkipped += skipped;
      allRemovedIds.push(...removedIds);
    } catch (e) {
      console.error("[sync] error syncing token:", e instanceof Error ? e.message : e);
    }
  }

  // Delete removed transactions across all banks (batch to avoid URL length limit)
  if (allRemovedIds.length > 0) {
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

  return { synced: totalSynced };
}

/**
 * Full-scan dedupe: delete duplicate transactions for a user.
 * Keeps the first occurrence (by id) per (normalized_merchant, amount, date).
 * Skips rows referenced by split_transactions or email_receipts.
 */
export async function deleteDuplicateTransactionsForUser(
  db: Awaited<ReturnType<typeof getSupabase>>,
  clerkUserId: string
): Promise<number> {
  const PAGE = 2000;
  let offset = 0;
  const seen = new Map<string, string>(); // key -> id to keep
  const idsToDelete: string[] = [];

  const { data: protectedSplits } = await db.from("split_transactions").select("transaction_id");
  const { data: protectedReceipts } = await db
    .from("email_receipts")
    .select("transaction_id")
    .not("transaction_id", "is", null);
  const protectedIds = new Set(
    [
      ...(protectedSplits ?? []).map((r) => r.transaction_id as string),
      ...(protectedReceipts ?? []).map((r) => r.transaction_id as string),
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
        idsToDelete.push(r.id as string);
      }
    }

    offset += rows.length;
    if (rows.length < PAGE) break;
  }

  if (idsToDelete.length === 0) return 0;

  const BATCH = 100;
  for (let i = 0; i < idsToDelete.length; i += BATCH) {
    const batch = idsToDelete.slice(i, i + BATCH);
    const { error } = await db.from("transactions").delete().in("id", batch);
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
        .eq("id", id);
      if (!updateErr) updated++;
    }
  }

  console.log(`[categorize] enriched ${updated}/${txs.length} transactions for ${clerkUserId}`);
  return updated;
}

// Called async after exchange-token — does not block the HTTP response
export async function embedTransactionsForUser(clerkUserId: string): Promise<void> {
  if (!openai) return;
  const db = getSupabase();

  const { data: rows } = await db
    .from("transactions")
    .select("id, merchant_name, raw_name, primary_category, amount, date")
    .eq("clerk_user_id", clerkUserId)
    .is("embedding", null)
    .limit(1000);

  if (!rows || rows.length === 0) return;

  const EMBED_BATCH = 100;
  for (let i = 0; i < rows.length; i += EMBED_BATCH) {
    const batch = rows.slice(i, i + EMBED_BATCH) as Array<{
      id: string;
      merchant_name: string | null;
      raw_name: string | null;
      primary_category: string | null;
      amount: number;
      date: string;
    }>;
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
