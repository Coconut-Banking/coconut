import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
import { getEffectiveUserId } from "@/lib/demo";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPlaidClient } from "@/lib/plaid-client";
import { getAllPlaidTokensForUser } from "@/lib/transaction-sync";
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
};

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

export async function GET() {
  const effectiveUserId = await getEffectiveUserId();
  if (!effectiveUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    // Serve from Supabase cache first
    const db = getSupabase();
    const { data: cached } = await db
      .from("accounts")
      .select("id, plaid_account_id, name, type, subtype, mask, balance_current, balance_available, iso_currency_code")
      .eq("clerk_user_id", effectiveUserId);

    if (cached && cached.length > 0) {
      const accounts = cached.map((acc) => {
        const row = acc as typeof acc & { id: string; balance_current?: number; balance_available?: number; iso_currency_code?: string };
        return {
          account_id: row.plaid_account_id,
          id: row.id,
          name: row.name,
          type: row.type,
          subtype: row.subtype,
          mask: row.mask,
          balance_current: row.balance_current ?? null,
          balance_available: row.balance_available ?? null,
          iso_currency_code: row.iso_currency_code ?? "USD",
        };
      });
      const deduped = deduplicateAccounts(db, effectiveUserId, accounts);
      return NextResponse.json(
        { accounts: deduped },
        { headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    // Fallback: accounts table empty but we may have tokens. Sync to populate accounts, then fetch from Plaid.
    const accessTokens = await getAllPlaidTokensForUser(effectiveUserId);
    if (!accessTokens || accessTokens.length === 0) return NextResponse.json({ error: "Not linked" }, { status: 401 });

    // One-time sync to ensure accounts table is populated (fixes "No accounts found" when transactions exist)
    try {
      const { syncTransactionsForUser } = await import("@/lib/transaction-sync");
      await syncTransactionsForUser(effectiveUserId);
    } catch (e) {
      console.warn("[plaid][accounts] sync to populate accounts failed:", e instanceof Error ? e.message : e);
    }

    // Re-check DB after sync (sync populates accounts)
    const { data: afterSync } = await db
      .from("accounts")
      .select("id, plaid_account_id, name, type, subtype, mask, balance_current, balance_available, iso_currency_code")
      .eq("clerk_user_id", effectiveUserId);
    if (afterSync && afterSync.length > 0) {
      const accounts = afterSync.map((acc) => {
        const row = acc as typeof acc & { id: string; balance_current?: number; balance_available?: number; iso_currency_code?: string };
        return {
          account_id: row.plaid_account_id,
          id: row.id,
          name: row.name,
          type: row.type,
          subtype: row.subtype,
          mask: row.mask,
          balance_current: row.balance_current ?? null,
          balance_available: row.balance_available ?? null,
          iso_currency_code: row.iso_currency_code ?? "USD",
        };
      });
      const deduped = deduplicateAccounts(db, effectiveUserId, accounts);
      return NextResponse.json(
        { accounts: deduped },
        { headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    // Fallback: get accounts via transaction account_ids (fixes clerk_user_id mismatch or stale data)
    const { data: txWithAcct } = await db
      .from("transactions")
      .select("account_id")
      .eq("clerk_user_id", effectiveUserId)
      .not("account_id", "is", null)
      .limit(500);
    const accounts = await getAccountsFromTransactionIds(db, effectiveUserId, txWithAcct ?? []);
    if (accounts && accounts.length > 0) {
      // Backfill: fix clerk_user_id on accounts so future requests hit primary path
      const acctIds = accounts.map((a) => a.id).filter(Boolean);
      if (acctIds.length > 0) {
        try {
          await db.from("accounts").update({ clerk_user_id: effectiveUserId }).in("id", acctIds);
        } catch (e) {
          console.warn("[plaid][accounts] backfill clerk_user_id failed:", e instanceof Error ? e.message : e);
        }
      }
      const deduped = deduplicateAccounts(db, effectiveUserId, accounts);
      return NextResponse.json(
        { accounts: deduped },
        { headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    // Last resort: fetch live from Plaid and upsert
    const client = getPlaidClient();
    if (!client) return NextResponse.json({ error: "Plaid not configured" }, { status: 503 });

    const allRows: Array<{ clerk_user_id: string; plaid_account_id: string; name: string; type: string; subtype: string | null; mask: string | null; balance_current: number | null; balance_available: number | null; iso_currency_code: string }> = [];
    for (const accessToken of accessTokens) {
      const response = await client.accountsGet({ access_token: accessToken });
      const rows = response.data.accounts.map((acct) => {
        const bal = acct.balances as { current?: number; available?: number; iso_currency_code?: string } | undefined;
        return {
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
      });
      allRows.push(...rows);
    }
    if (allRows.length > 0) {
      await db.from("accounts").upsert(allRows, { onConflict: "plaid_account_id" });
    }
    const { data: updated } = await db.from("accounts").select("id, plaid_account_id, name, type, subtype, mask, balance_current, balance_available, iso_currency_code").eq("clerk_user_id", effectiveUserId);
    const accounts: AccountRow[] = (updated ?? []).map((row: Record<string, unknown>) => ({
      account_id: String(row.plaid_account_id ?? ""),
      id: String(row.id ?? ""),
      name: String(row.name ?? ""),
      type: row.type as string | undefined,
      subtype: row.subtype as string | null | undefined,
      mask: row.mask as string | null | undefined,
      balance_current: (row.balance_current as number | null) ?? null,
      balance_available: (row.balance_available as number | null) ?? null,
      iso_currency_code: (row.iso_currency_code as string) ?? "USD",
    }));
    const deduped = deduplicateAccounts(db, effectiveUserId, accounts);
    return NextResponse.json(
      { accounts: deduped },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to get accounts";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
