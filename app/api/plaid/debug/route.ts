import { NextResponse } from "next/server";
import { getEffectiveUserId } from "@/lib/demo";
import { getSupabase } from "@/lib/supabase";
import { getAllPlaidTokensForUser } from "@/lib/transaction-sync";
import { getPlaidClient } from "@/lib/plaid-client";

/**
 * Diagnostic endpoint to debug "No accounts found" issues.
 * Returns sanitized counts and status - no sensitive data.
 * GET /api/plaid/debug
 */
export async function GET() {
  const effectiveUserId = await getEffectiveUserId();
  if (!effectiveUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getSupabase();

    // plaid_items count
    const { count: plaidCount } = await db
      .from("plaid_items")
      .select("id", { count: "exact", head: true })
      .eq("clerk_user_id", effectiveUserId);

    // accounts count
    const { count: accountsCount } = await db
      .from("accounts")
      .select("id", { count: "exact", head: true })
      .eq("clerk_user_id", effectiveUserId);

    // Try Plaid accountsGet for first token
    let plaidError: string | null = null;
    let plaidAccountCount = 0;
    const tokens = await getAllPlaidTokensForUser(effectiveUserId);
    if (tokens.length > 0) {
      const client = getPlaidClient();
      if (client) {
        try {
          const resp = await client.accountsGet({ access_token: tokens[0] });
          plaidAccountCount = resp.data.accounts?.length ?? 0;
        } catch (e) {
          plaidError = e instanceof Error ? e.message : String(e);
        }
      } else {
        plaidError = "Plaid not configured";
      }
    }

    return NextResponse.json({
      ok: true,
      plaid_items_count: plaidCount ?? 0,
      accounts_count: accountsCount ?? 0,
      plaid_tokens_count: tokens.length,
      plaid_accounts_from_api: plaidAccountCount,
      plaid_error: plaidError,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Debug failed" },
      { status: 500 }
    );
  }
}
