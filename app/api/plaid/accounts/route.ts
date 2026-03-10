import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPlaidClient } from "@/lib/plaid-client";
import { getPlaidTokenForUser } from "@/lib/transaction-sync";

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
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    // Serve from Supabase cache first
    const db = getSupabase();
    const { data: cached } = await db
      .from("accounts")
      .select("*")
      .eq("clerk_user_id", userId);

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
      const deduped = deduplicateAccounts(db, userId, accounts);
      return NextResponse.json({ accounts: deduped });
    }

    // Fallback: fetch live from Plaid
    const accessToken = await getPlaidTokenForUser(userId);
    if (!accessToken) return NextResponse.json({ error: "Not linked" }, { status: 401 });

    const client = getPlaidClient();
    if (!client) return NextResponse.json({ error: "Plaid not configured" }, { status: 503 });

    const response = await client.accountsGet({ access_token: accessToken });
    // Upsert to ensure we have DB ids (for transaction filtering)
    for (const acct of response.data.accounts) {
      const bal = acct.balances as { current?: number; available?: number; iso_currency_code?: string } | undefined;
      const base = { clerk_user_id: userId, plaid_account_id: acct.account_id, name: acct.name, type: acct.type, subtype: acct.subtype ?? null, mask: acct.mask ?? null };
      try {
        await db.from("accounts").upsert(
          { ...base, balance_current: bal?.current ?? null, balance_available: bal?.available ?? null, iso_currency_code: bal?.iso_currency_code ?? "USD" },
          { onConflict: "plaid_account_id" }
        );
      } catch {
        await db.from("accounts").upsert(base, { onConflict: "plaid_account_id" });
      }
    }
    const { data: updated } = await db.from("accounts").select("*").eq("clerk_user_id", userId);
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
    const deduped = deduplicateAccounts(db, userId, accounts);
    return NextResponse.json({ accounts: deduped });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to get accounts";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
