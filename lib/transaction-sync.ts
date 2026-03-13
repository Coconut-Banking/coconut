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
    .single();
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

export async function savePlaidToken(
  clerkUserId: string,
  accessToken: string,
  plaidItemId: string,
  institutionName?: string | null
) {
  const db = getSupabase();
  // Conflict on plaid_item_id so each bank item is stored separately.
  // This allows a user to connect multiple banks.
  await db.from("plaid_items").upsert(
    {
      clerk_user_id: clerkUserId,
      access_token: accessToken,
      plaid_item_id: plaidItemId,
      institution_name: institutionName ?? null,
    },
    { onConflict: "plaid_item_id" }
  );
}

async function syncSingleToken(
  clerkUserId: string,
  accessToken: string,
  plaid: ReturnType<typeof getPlaidClient>,
  db: ReturnType<typeof getSupabase>
): Promise<{ synced: number; removedIds: string[] }> {
  if (!plaid) return { synced: 0, removedIds: [] };

  // Upsert accounts for this bank
  const { data: acctResp } = await plaid.accountsGet({ access_token: accessToken });
  for (const acct of acctResp.accounts) {
    const bal = acct.balances as { current?: number; available?: number; iso_currency_code?: string } | undefined;
    const row: Record<string, unknown> = {
      clerk_user_id: clerkUserId,
      plaid_account_id: acct.account_id,
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
    } catch {
      await db.from("accounts").upsert(row, { onConflict: "plaid_account_id" });
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

  // Fetch all transactions from Plaid via cursor sync
  const allAdded: Array<Record<string, unknown>> = [];
  const allModified: Array<Record<string, unknown>> = [];
  const allRemovedIds: string[] = [];
  let cursor: string | undefined;
  let hasMore = true;
  while (hasMore) {
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
  }

  const allTxs = [...allAdded, ...allModified];
  if (allTxs.length === 0 && allRemovedIds.length === 0) return { synced: 0, removedIds: [] };

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

  const BATCH = 100;
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await db
      .from("transactions")
      .upsert(rows.slice(i, i + BATCH), { onConflict: "plaid_transaction_id" });
    if (error) console.error("[sync] upsert error:", error.message);
  }

  return { synced: rows.length, removedIds: allRemovedIds };
}

export async function syncTransactionsForUser(
  clerkUserId: string
): Promise<{ synced: number; error?: string }> {
  const db = getSupabase();
  const accessTokens = await getAllPlaidTokensForUser(clerkUserId);
  if (accessTokens.length === 0) return { synced: 0, error: "No Plaid connection found for user" };

  const plaid = getPlaidClient();
  if (!plaid) return { synced: 0, error: "Plaid not configured" };

  let totalSynced = 0;
  const allRemovedIds: string[] = [];

  for (const token of accessTokens) {
    try {
      const { synced, removedIds } = await syncSingleToken(clerkUserId, token, plaid, db);
      totalSynced += synced;
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

  return { synced: totalSynced };
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
