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
    const key = `${a.name ?? ""}|${a.mask ?? ""}`;
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

export async function GET(request: NextRequest) {
  const effectiveUserId = await getEffectiveUserId();
  if (!effectiveUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";

  try {
    const db = getSupabase();

    // When refresh=1, bypass cache to fetch live (fixes newly connected banks not showing)
    if (!forceRefresh) {
      const { data: cached } = await db
        .from("accounts")
        .select("id, plaid_account_id, plaid_item_id, name, type, subtype, mask, balance_current, balance_available, iso_currency_code")
        .eq("clerk_user_id", effectiveUserId);

      if (cached && cached.length > 0) {
        const accounts = cached.map((acc) => {
        const row = acc as typeof acc & { id: string; plaid_item_id?: string | null; balance_current?: number; balance_available?: number; iso_currency_code?: string };
        return {
          account_id: row.plaid_account_id,
          id: row.id,
          plaid_item_id: row.plaid_item_id ?? null,
          name: row.name,
          type: row.type,
          subtype: row.subtype,
          mask: row.mask,
          balance_current: row.balance_current ?? null,
          balance_available: row.balance_available ?? null,
          iso_currency_code: row.iso_currency_code ?? "USD",
        };
        });
        const withInstitution = await enrichAccountsWithInstitution(db, accounts);
        const deduped = deduplicateAccounts(db, effectiveUserId, withInstitution);
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
      const withInstitution = await enrichAccountsWithInstitution(db, txAccounts as unknown as AccountRow[]);
      const deduped = await deduplicateAccounts(db, effectiveUserId, withInstitution);
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
    const { data: afterSync } = await db
      .from("accounts")
      .select("id, plaid_account_id, plaid_item_id, name, type, subtype, mask, balance_current, balance_available, iso_currency_code")
      .eq("clerk_user_id", effectiveUserId);
    if (afterSync && afterSync.length > 0) {
      const accounts = afterSync.map((acc) => {
        const row = acc as typeof acc & { id: string; plaid_item_id?: string | null; balance_current?: number; balance_available?: number; iso_currency_code?: string };
        return {
          account_id: row.plaid_account_id,
          id: row.id,
          plaid_item_id: row.plaid_item_id ?? null,
          name: row.name,
          type: row.type,
          subtype: row.subtype,
          mask: row.mask,
          balance_current: row.balance_current ?? null,
          balance_available: row.balance_available ?? null,
          iso_currency_code: row.iso_currency_code ?? "USD",
        };
      });
      const withInstitution = await enrichAccountsWithInstitution(db, accounts);
      const deduped = deduplicateAccounts(db, effectiveUserId, withInstitution);
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

    const allRows: Array<{ clerk_user_id: string; plaid_account_id: string; plaid_item_id?: string; name: string; type: string; subtype: string | null; mask: string | null; balance_current: number | null; balance_available: number | null; iso_currency_code: string }> = [];
    for (const accessToken of accessTokens) {
      const item = tokenToItem.get(accessToken);
      const response = await client.accountsGet({ access_token: accessToken });
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
    const { data: updated } = await db.from("accounts").select("id, plaid_account_id, plaid_item_id, name, type, subtype, mask, balance_current, balance_available, iso_currency_code").eq("clerk_user_id", effectiveUserId);
    const plaidAccounts: AccountRow[] = (updated ?? []).map((row: Record<string, unknown>) => ({
      account_id: String(row.plaid_account_id ?? ""),
      id: String(row.id ?? ""),
      plaid_item_id: (row.plaid_item_id as string | null) ?? null,
      name: String(row.name ?? ""),
      type: row.type as string | undefined,
      subtype: row.subtype as string | null | undefined,
      mask: row.mask as string | null | undefined,
      balance_current: (row.balance_current as number | null) ?? null,
      balance_available: (row.balance_available as number | null) ?? null,
      iso_currency_code: (row.iso_currency_code as string) ?? "USD",
    }));
    const withInstitution = await enrichAccountsWithInstitution(db, plaidAccounts);
    const deduped = await deduplicateAccounts(db, effectiveUserId, withInstitution);
    return NextResponse.json(
      { accounts: deduped },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to get accounts";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
