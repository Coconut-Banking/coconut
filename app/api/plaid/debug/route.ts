import { NextResponse } from "next/server";
import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";
import { getEffectiveUserId } from "@/lib/demo";
import { getSupabase } from "@/lib/supabase";
import { getAllPlaidTokensForUser } from "@/lib/transaction-sync";
import { getPlaidClient } from "@/lib/plaid-client";

const PLAID_CLIENT_ID = process.env.PLAID_CLIENT_ID;
const PLAID_SANDBOX_SECRET = process.env.PLAID_SANDBOX_SECRET;
const PLAID_PRODUCTION_SECRET = process.env.PLAID_PRODUCTION_SECRET;
const PLAID_ENV = process.env.PLAID_ENV ?? "sandbox";

function createPlaidClientForEnv(env: "sandbox" | "production"): PlaidApi | null {
  const secret = env === "production" ? PLAID_PRODUCTION_SECRET : PLAID_SANDBOX_SECRET;
  if (!PLAID_CLIENT_ID || !secret) return null;
  const basePath = env === "production" ? PlaidEnvironments.production : PlaidEnvironments.sandbox;
  const config = new Configuration({
    basePath,
    baseOptions: {
      headers: { "PLAID-CLIENT-ID": PLAID_CLIENT_ID, "PLAID-SECRET": secret },
    },
  });
  return new PlaidApi(config);
}

/**
 * Diagnostic endpoint to debug "No accounts found" issues.
 * Verifies token against sandbox and production to detect PLAID_ENV mismatch.
 * GET /api/plaid/debug
 */
export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
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

    // Try Plaid accountsGet for first token + verify which env it belongs to
    let plaidError: string | null = null;
    let plaidAccountCount = 0;
    let token_works_in_sandbox: boolean | null = null;
    let token_works_in_production: boolean | null = null;

    const tokens = await getAllPlaidTokensForUser(effectiveUserId);
    if (tokens.length > 0) {
      const accessToken = tokens[0];

      // Try current env (default client)
      const client = getPlaidClient();
      if (client) {
        try {
          const resp = await client.accountsGet({ access_token: accessToken });
          plaidAccountCount = resp.data.accounts?.length ?? 0;
        } catch (e) {
          plaidError = e instanceof Error ? e.message : String(e);
        }
      } else {
        plaidError = "Plaid not configured";
      }

      // Verify: try token with sandbox and/or production to detect mismatch.
      // In production, never call sandbox API (Plaid production checklist).
      const prodClient = createPlaidClientForEnv("production");
      if (prodClient) {
        try {
          await prodClient.accountsGet({ access_token: accessToken });
          token_works_in_production = true;
        } catch {
          token_works_in_production = false;
        }
      }
      if (PLAID_ENV !== "production") {
        const sandboxClient = createPlaidClientForEnv("sandbox");
        if (sandboxClient) {
          try {
            await sandboxClient.accountsGet({ access_token: accessToken });
            token_works_in_sandbox = true;
          } catch {
            token_works_in_sandbox = false;
          }
        }
      }
    }

    const env_mismatch =
      PLAID_ENV === "production"
        ? token_works_in_production === false
        : (token_works_in_sandbox === false && token_works_in_production === true);

    return NextResponse.json({
      ok: true,
      effective_user_id: effectiveUserId,
      PLAID_ENV,
      plaid_items_count: plaidCount ?? 0,
      accounts_count: accountsCount ?? 0,
      plaid_tokens_count: tokens.length,
      plaid_accounts_from_api: plaidAccountCount,
      plaid_error: plaidError,
      token_works_in_sandbox: token_works_in_sandbox ?? null,
      token_works_in_production: token_works_in_production ?? null,
      env_mismatch,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Debug failed" },
      { status: 500 }
    );
  }
}
