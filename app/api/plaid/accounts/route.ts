import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { getPlaidClient } from "@/lib/plaid-client";
import { getPlaidTokenForUser } from "@/lib/transaction-sync";

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
      return NextResponse.json({
        accounts: cached.map((acc) => {
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
        }),
      });
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
    return NextResponse.json({
      accounts: (updated ?? []).map((row: Record<string, unknown>) => ({
        account_id: row.plaid_account_id,
        id: row.id,
        name: row.name,
        type: row.type,
        subtype: row.subtype,
        mask: row.mask,
        balance_current: row.balance_current ?? null,
        balance_available: row.balance_available ?? null,
        iso_currency_code: row.iso_currency_code ?? "USD",
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to get accounts";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
