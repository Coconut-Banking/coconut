/**
 * Cached Supabase queries to reduce egress.
 * Uses Next.js unstable_cache with tags for invalidation.
 *
 * Invalidate when:
 *   - Plaid sync completes → revalidateTag(`transactions:${userId}`)
 *   - Subscription detection runs → revalidateTag(`transactions:${userId}`)
 *   - Split created/deleted → revalidateTag(`split_transactions:${userId}`)
 */

import { unstable_cache } from "next/cache";
import { getSupabase } from "./supabase";
import { CACHE } from "./config";

export const CACHE_TAGS = {
  transactions: (userId: string) => `transactions:${userId}` as const,
  splitTransactions: (userId: string) => `split_transactions:${userId}` as const,
} as const;

export interface TransactionRow {
  id: string;
  plaid_transaction_id: string;
  account_id: string | null;
  merchant_name: string | null;
  raw_name: string | null;
  normalized_merchant?: string | null;
  amount: number;
  date: string;
  primary_category: string | null;
  detailed_category: string | null;
  iso_currency_code: string | null;
  is_pending: boolean | null;
}

export async function getCachedTransactions(
  userId: string,
  opts?: { bypassCache?: boolean }
): Promise<{ data: TransactionRow[] | null; error: { message: string } | null }> {
  if (opts?.bypassCache) {
    return fetchTransactions(userId);
  }

  return unstable_cache(
    () => fetchTransactions(userId),
    ["transactions", userId],
    {
      tags: [CACHE_TAGS.transactions(userId)],
      revalidate: CACHE.TRANSACTIONS_REVALIDATE_SEC,
    }
  )();
}

async function fetchTransactions(
  userId: string
): Promise<{ data: TransactionRow[] | null; error: { message: string } | null }> {
  const db = getSupabase();
  const { data, error } = await db
    .from("transactions")
    .select(
      "id, plaid_transaction_id, account_id, merchant_name, raw_name, normalized_merchant, amount, date, primary_category, detailed_category, iso_currency_code, is_pending"
    )
    .eq("clerk_user_id", userId)
    .order("date", { ascending: false })
    .order("id", { ascending: false })
    .limit(2000);

  return {
    data: data as TransactionRow[] | null,
    error: error ? { message: error.message } : null,
  };
}
