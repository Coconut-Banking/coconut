import type { SupabaseClient } from "@supabase/supabase-js";

export type AccountForDisplay = {
  account_id: string;
  id: string;
  name: string;
  type?: string;
  subtype?: string | null;
  mask?: string | null;
  balance_current?: number | null;
  balance_available?: number | null;
  iso_currency_code?: string;
  plaid_item_id?: string | null;
  institution_name?: string | null;
};

/**
 * Get accounts for display when primary clerk_user_id lookup returns empty.
 * Uses transaction account_ids to find accounts (handles clerk_user_id mismatch).
 */
export async function getAccountsFromTransactionIds(
  db: SupabaseClient,
  userId: string,
  txAccountIds: Array<{ account_id: string | null }>
): Promise<AccountForDisplay[] | null> {
  const acctIds = [...new Set(txAccountIds.map((r) => r.account_id).filter(Boolean) as string[])];
  if (acctIds.length === 0) return null;

  const { data } = await db
    .from("accounts")
    .select("id, plaid_account_id, plaid_item_id, name, type, subtype, mask, balance_current, balance_available, iso_currency_code")
    .in("id", acctIds);

  if (!data || data.length === 0) return null;

  return data.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      account_id: String(r.plaid_account_id ?? ""),
      id: String(r.id ?? ""),
      plaid_item_id: (r.plaid_item_id as string | null) ?? null,
      name: String(r.name ?? ""),
      type: r.type as string | undefined,
      subtype: r.subtype as string | null | undefined,
      mask: r.mask as string | null | undefined,
      balance_current: (r.balance_current as number | null) ?? null,
      balance_available: (r.balance_available as number | null) ?? null,
      iso_currency_code: (r.iso_currency_code as string) ?? "USD",
    };
  });
}
