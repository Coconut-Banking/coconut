import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
import { getEffectiveUserId } from "@/lib/demo";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPlaidClient } from "@/lib/plaid-client";
import { getAllPlaidTokensForUser, getPlaidItemsForUser } from "@/lib/transaction-sync";
import { getAccountsFromTransactionIds } from "@/lib/accounts-for-user";

type AccountRow = {
  account_id: string;
  id: string;
  name: string;
  nickname?: string | null;
  type?: string;
  subtype?: string | null;
  mask?: string | null;
  balance_current?: number | null;
  balance_available?: number | null;
  iso_currency_code?: string;
  institution_name?: string | null;
  plaid_item_id?: string | null;
};

/** Enrich accounts with institution_name from plaid_items */
async function enrichAccountsWithInstitution(
  db: SupabaseClient,
  accounts: AccountRow[]
): Promise<AccountRow[]> {
  const itemIds = [...new Set(accounts.map((a) => a.plaid_item_id).filter(Boolean))] as string[];
  if (itemIds.length === 0) return accounts;
  const { data: items } = await db
    .from("plaid_items")
    .select("plaid_item_id, institution_name")
    .in("plaid_item_id", itemIds);
  const instByItem = new Map((items ?? []).map((i) => [i.plaid_item_id as string, (i.institution_name as string) ?? null]));
  return accounts.map((a) => {
    const itemId = (a as { plaid_item_id?: string | null }).plaid_item_id;
    return { ...a, institution_name: itemId ? instByItem.get(itemId) ?? null : null };
  });
}

/** Dedupe accounts with same name+mask; prefer the one that has transactions. */
async function deduplicateAccounts(
  db: SupabaseClient,
  userId: string,
  accounts: AccountRow[]
): Promise<AccountRow[]> {
  if (accounts.length <= 1) return accounts;

  const { data: txAccountIds } = await db
    .from("transactions")
    .select("account_id")
    .eq("clerk_user_id", userId)
    .not("account_id", "is", null);
  const idsWithTx = new Set(
    (txAccountIds ?? []).map((r) => (r.account_id as string)).filter(Boolean)
  );

  const byKey = new Map<string, AccountRow[]>();
  for (const a of accounts) {
    const key = `${a.name ?? ""}|${a.mask ?? ""}|${a.subtype ?? ""}`;
    const list = byKey.get(key) ?? [];
    list.push(a);
    byKey.set(key, list);
  }

  const result: AccountRow[] = [];
  for (const list of byKey.values()) {
    if (list.length === 1) {
      result.push(list[0]);
      continue;
    }
    // Prefer account that has transactions
    const withTx = list.filter((a) => idsWithTx.has(a.id));
    result.push(withTx.length > 0 ? withTx[0] : list[0]);
  }
  return result;
}

/** Run institution enrichment and account dedup in parallel, then merge results. */
async function enrichAndDedup(db: SupabaseClient, userId: string, accounts: AccountRow[]): Promise<AccountRow[]> {
  const [enriched, deduped] = await Promise.all([
    enrichAccountsWithInstitution(db, accounts),
    deduplicateAccounts(db, userId, accounts),
  ]);
  const instById = new Map(enriched.map((a) => [a.id, a.institution_name ?? null]));
  return deduped.map((a) => ({ ...a, institution_name: instById.get(a.id) ?? null }));
}

export async function GET(request: NextRequest) {
  const effectiveUserId = await getEffectiveUserId();
  if (!effectiveUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";

  try {
    const db = getSupabase();
    const baseSelect = "id, plaid_account_id, name, nickname, type, subtype, mask, balance_current, balance_available, iso_currency_code";

    // When refresh=1, fetch ALL accounts directly from Plaid (includes investment/TFSA/RRSP
    // accounts that have no transactions and would otherwise never appear in the DB).
    if (forceRefresh) {
      const client = getPlaidClient();
      // Parallelize token + item fetches (both independent DB reads)
      const [accessTokens, items] = await Promise.all([
        getAllPlaidTokensForUser(effectiveUserId),
        getPlaidItemsForUser(effectiveUserId),
      ]);
      if (client && accessTokens && accessTokens.length > 0) {
        const tokenToItem = new Map(items.map((i) => [i.access_token, i]));
        const results = await Promise.allSettled(
          accessTokens.map((accessToken) => client.accountsGet({ access_token: accessToken }))
        );
        const allRows: Array<{ clerk_user_id: string; plaid_account_id: string; plaid_item_id?: string; name: string; type: string; subtype: string | null; mask: string | null; balance_current: number | null; balance_available: number | null; iso_currency_code: string }> = [];
        for (let idx = 0; idx < accessTokens.length; idx++) {
          const result = results[idx];
          if (result.status === "rejected") {
            console.error("[plaid][accounts] refresh accountsGet failed:", result.reason instanceof Error ? result.reason.message : result.reason);
            continue;
          }
          const response = result.value;
          if (!response.data?.accounts || !Array.isArray(response.data.accounts)) continue;
          const accessToken = accessTokens[idx];
          const item = tokenToItem.get(accessToken);
          const rows = response.data.accounts.map((acct) => {
            const bal = acct.balances as { current?: number; available?: number; iso_currency_code?: string } | undefined;
            const row: { clerk_user_id: string; plaid_account_id: string; plaid_item_id?: string; name: string; type: string; subtype: string | null; mask: string | null; balance_current: number | null; balance_available: number | null; iso_currency_code: string } = {
              clerk_user_id: effectiveUserId,
              plaid_account_id: acct.account_id,
              name: acct.name,
              type: acct.type,
              subtype: acct.subtype ?? null,
              mask: acct.mask ?? null,
              balance_current: bal?.current ?? null,
              balance_available: bal?.available ?? null,
              iso_currency_code: bal?.iso_currency_code ?? "USD",
            };
            if (item?.plaid_item_id) row.plaid_item_id = item.plaid_item_id;
            return row;
          });
          allRows.push(...rows);
        }
        if (allRows.length > 0) {
          await db.from("accounts").upsert(allRows, { onConflict: "plaid_account_id" });
        }
      }
      // Return all accounts from DB (now includes freshly upserted ones)
      let { data: refreshed, error: refreshErr } = await db
        .from("accounts")
        .select(`${baseSelect}, plaid_item_id`)
        .eq("clerk_user_id", effectiveUserId);
      if (refreshErr && /plaid_item_id|does not exist/i.test(refreshErr.message)) {
        const fallback = await db.from("accounts").select(baseSelect).eq("clerk_user_id", effectiveUserId);
        refreshed = (fallback.data ?? []).map((r) => Object.assign({}, r, { plaid_item_id: null }));
      }
      const accounts: AccountRow[] = (refreshed ?? []).map((row: Record<string, unknown>) => ({
        account_id: String(row.plaid_account_id ?? ""),
        id: String(row.id ?? ""),
        plaid_item_id: (row.plaid_item_id as string | null) ?? null,
        name: String(row.name ?? ""),
        nickname: (row.nickname as string | null) ?? null,
        type: row.type as string | undefined,
        subtype: row.subtype as string | null | undefined,
        mask: row.mask as string | null | undefined,
        balance_current: (row.balance_current as number | null) ?? null,
        balance_available: (row.balance_available as number | null) ?? null,
        iso_currency_code: (row.iso_currency_code as string) ?? "USD",
      }));
      const deduped = await enrichAndDedup(db, effectiveUserId, accounts);
      return NextResponse.json(
        { accounts: deduped },
        { headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    // Normal path: return cached accounts from DB
    {
      let { data: cached, error: cachedErr } = await db
        .from("accounts")
        .select(`${baseSelect}, plaid_item_id`)
        .eq("clerk_user_id", effectiveUserId);
      if (cachedErr && /plaid_item_id|does not exist/i.test(cachedErr.message)) {
        const fallback = await db.from("accounts").select(baseSelect).eq("clerk_user_id", effectiveUserId);
        cached = (fallback.data ?? []).map((r) => Object.assign({}, r, { plaid_item_id: null }));
      }

      if (cached && cached.length > 0) {
        const accounts = cached.map((acc) => {
        const row = acc as typeof acc & { id: string; plaid_item_id?: string | null; balance_current?: number; balance_available?: number; iso_currency_code?: string };
        return {
          account_id: row.plaid_account_id,
          id: row.id,
          plaid_item_id: row.plaid_item_id ?? null,
          name: row.name,
          nickname: (row as Record<string, unknown>).nickname as string | null ?? null,
          type: row.type,
          subtype: row.subtype,
          mask: row.mask,
          balance_current: row.balance_current ?? null,
          balance_available: row.balance_available ?? null,
          iso_currency_code: row.iso_currency_code ?? "USD",
        };
        });
        const deduped = await enrichAndDedup(db, effectiveUserId, accounts);
        return NextResponse.json(
          { accounts: deduped },
          { headers: { "Cache-Control": "no-store, max-age=0" } }
        );
      }
    }

    // Try transaction-based lookup FIRST — transactions have account_id; fetch those accounts directly.
    // Fixes "no accounts" when accounts.clerk_user_id is wrong or not set (e.g. multi-bank migration).
    const { data: txWithAcct } = await db
      .from("transactions")
      .select("account_id")
      .eq("clerk_user_id", effectiveUserId)
      .not("account_id", "is", null)
      .limit(500);
    const txAccounts = await getAccountsFromTransactionIds(db, effectiveUserId, txWithAcct ?? []);
    if (txAccounts && txAccounts.length > 0) {
      const acctIds = txAccounts.map((a) => a.id).filter(Boolean);
      if (acctIds.length > 0) {
        try {
          await db.from("accounts").update({ clerk_user_id: effectiveUserId }).in("id", acctIds);
        } catch (e) {
          console.warn("[plaid][accounts] backfill clerk_user_id failed:", e instanceof Error ? e.message : e);
        }
      }
      // Fetch nicknames separately since AccountForDisplay doesn't include them
      const { data: nicknameRows } = acctIds.length > 0
        ? await db.from("accounts").select("id, nickname").in("id", acctIds)
        : { data: [] as { id: string; nickname: string | null }[] };
      const nicknameById = new Map((nicknameRows ?? []).map((n: { id: string; nickname: string | null }) => [n.id, n.nickname]));
      const accountRows = txAccounts.map((a: typeof txAccounts[0]) => ({
        ...a,
        nickname: nicknameById.get(a.id) ?? null,
      }));
      const deduped = await enrichAndDedup(db, effectiveUserId, accountRows as AccountRow[]);
      return NextResponse.json(
        { accounts: deduped },
        { headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    // Sync and fetch from Plaid.
    const accessTokens = await getAllPlaidTokensForUser(effectiveUserId);
    if (!accessTokens || accessTokens.length === 0) return NextResponse.json({ error: "Not linked" }, { status: 401 });

    // One-time sync to ensure accounts table is populated
    try {
      const { syncTransactionsForUser } = await import("@/lib/transaction-sync");
      await syncTransactionsForUser(effectiveUserId);
    } catch (e) {
      console.warn("[plaid][accounts] sync to populate accounts failed:", e instanceof Error ? e.message : e);
    }

    // Re-check DB after sync (sync populates accounts)
    let { data: afterSync, error: afterSyncErr } = await db
      .from("accounts")
      .select(`${baseSelect}, plaid_item_id`)
      .eq("clerk_user_id", effectiveUserId);
    if (afterSyncErr && /plaid_item_id|does not exist/i.test(afterSyncErr.message)) {
      const fallback = await db.from("accounts").select(baseSelect).eq("clerk_user_id", effectiveUserId);
      afterSync = (fallback.data ?? []).map((r) => Object.assign({}, r, { plaid_item_id: null }));
    }
    if (afterSync && afterSync.length > 0) {
      const accounts = afterSync.map((acc) => {
        const row = acc as typeof acc & { id: string; plaid_item_id?: string | null; balance_current?: number; balance_available?: number; iso_currency_code?: string };
        return {
          account_id: row.plaid_account_id,
          id: row.id,
          plaid_item_id: row.plaid_item_id ?? null,
          name: row.name,
          nickname: (row as Record<string, unknown>).nickname as string | null ?? null,
          type: row.type,
          subtype: row.subtype,
          mask: row.mask,
          balance_current: row.balance_current ?? null,
          balance_available: row.balance_available ?? null,
          iso_currency_code: row.iso_currency_code ?? "USD",
        };
      });
      const deduped = await enrichAndDedup(db, effectiveUserId, accounts);
      return NextResponse.json(
        { accounts: deduped },
        { headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    // Last resort: fetch live from Plaid and upsert
    const client = getPlaidClient();
    if (!client) return NextResponse.json({ error: "Plaid not configured" }, { status: 503 });

    const items = await getPlaidItemsForUser(effectiveUserId);
    const tokenToItem = new Map(items.map((i) => [i.access_token, i]));

    const accountResults = await Promise.allSettled(
      accessTokens.map(async (accessToken) => {
        const item = tokenToItem.get(accessToken);
        const response = await client.accountsGet({ access_token: accessToken });
        if (!response.data?.accounts || !Array.isArray(response.data.accounts)) {
          console.error("[plaid][accounts] accountsGet returned invalid data");
          return [];
        }
        return response.data.accounts.map((acct) => {
          const bal = acct.balances as { current?: number; available?: number; iso_currency_code?: string } | undefined;
          const row: { clerk_user_id: string; plaid_account_id: string; plaid_item_id?: string; name: string; type: string; subtype: string | null; mask: string | null; balance_current: number | null; balance_available: number | null; iso_currency_code: string } = {
            clerk_user_id: effectiveUserId,
            plaid_account_id: acct.account_id,
            name: acct.name,
            type: acct.type,
            subtype: acct.subtype ?? null,
            mask: acct.mask ?? null,
            balance_current: bal?.current ?? null,
            balance_available: bal?.available ?? null,
            iso_currency_code: bal?.iso_currency_code ?? "USD",
          };
          if (item?.plaid_item_id) row.plaid_item_id = item.plaid_item_id;
          return row;
        });
      })
    );
    const allRows: Array<{ clerk_user_id: string; plaid_account_id: string; plaid_item_id?: string; name: string; type: string; subtype: string | null; mask: string | null; balance_current: number | null; balance_available: number | null; iso_currency_code: string }> = [];
    for (const result of accountResults) {
      if (result.status === "fulfilled") {
        allRows.push(...result.value);
      } else {
        console.error("[plaid][accounts] accountsGet failed for token, skipping:", result.reason instanceof Error ? result.reason.message : result.reason);
      }
    }
    if (allRows.length > 0) {
      await db.from("accounts").upsert(allRows, { onConflict: "plaid_account_id" });
    }
    let { data: updated, error: updatedErr } = await db.from("accounts").select(`${baseSelect}, plaid_item_id`).eq("clerk_user_id", effectiveUserId);
    if (updatedErr && /plaid_item_id|does not exist/i.test(updatedErr.message)) {
      const fallback = await db.from("accounts").select(baseSelect).eq("clerk_user_id", effectiveUserId);
      updated = (fallback.data ?? []).map((r) => Object.assign({}, r, { plaid_item_id: null }));
    }
    const plaidAccounts: AccountRow[] = (updated ?? []).map((row: Record<string, unknown>) => ({
      account_id: String(row.plaid_account_id ?? ""),
      id: String(row.id ?? ""),
      plaid_item_id: (row.plaid_item_id as string | null) ?? null,
      name: String(row.name ?? ""),
      nickname: (row.nickname as string | null) ?? null,
      type: row.type as string | undefined,
      subtype: row.subtype as string | null | undefined,
      mask: row.mask as string | null | undefined,
      balance_current: (row.balance_current as number | null) ?? null,
      balance_available: (row.balance_available as number | null) ?? null,
      iso_currency_code: (row.iso_currency_code as string) ?? "USD",
    }));
    const deduped = await enrichAndDedup(db, effectiveUserId, plaidAccounts);
    return NextResponse.json(
      { accounts: deduped },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (err) {
    console.error("[plaid][accounts] error:", err);
    return NextResponse.json({ error: "Failed to get accounts" }, { status: 500 });
  }
}
