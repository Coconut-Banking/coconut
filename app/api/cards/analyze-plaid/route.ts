/**
 * POST /api/cards/analyze-plaid
 * For new (non-Coconut) users: exchange a Plaid public_token, fetch 3 months
 * of transactions, categorize spend, and create a card_tool_sessions record.
 */
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getPlaidClient } from "@/lib/plaid-client";
import { getSupabaseAdmin } from "@/lib/supabase";
import { encryptToken } from "@/lib/encryption";
import { categorizeTransactions, matchPlaidAccountsToCards } from "@/lib/card-recommendations";
import type { CreditCard } from "@/lib/card-recommendations";
import { rateLimit } from "@/lib/rate-limit";

type AnalyzePlaidBody = {
  public_token?: string;
};

type SpendSummary = {
  dining: number; travel: number; groceries: number; gas: number;
  streaming: number; transit: number; other: number; total: number;
  months_analyzed: number;
};

function mergeSpendSummaries(a: SpendSummary, b: SpendSummary): SpendSummary {
  // Both are monthly averages over the same 90-day window — add category-by-category
  return {
    dining: a.dining + b.dining,
    travel: a.travel + b.travel,
    groceries: a.groceries + b.groceries,
    gas: a.gas + b.gas,
    streaming: a.streaming + b.streaming,
    transit: a.transit + b.transit,
    other: a.other + b.other,
    total: a.total + b.total,
    months_analyzed: Math.max(a.months_analyzed, b.months_analyzed),
  };
}

export async function POST(request: NextRequest) {
  let body: AnalyzePlaidBody;
  try {
    body = (await request.json()) as AnalyzePlaidBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { public_token } = body;
  if (!public_token) {
    return NextResponse.json({ error: "public_token required" }, { status: 400 });
  }

  // Rate limit by IP
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = rateLimit(`cards-analyze-plaid:${ip}`, 5, 60_000);
  if (!rl.success) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const client = getPlaidClient();
  if (!client) {
    return NextResponse.json({ error: "Plaid is not configured" }, { status: 503 });
  }

  try {
    // Exchange public token for access token
    const exchangeResp = await client.itemPublicTokenExchange({ public_token });
    const { access_token, item_id } = exchangeResp.data;

    if (!access_token || !item_id) {
      return NextResponse.json({ error: "Failed to exchange token" }, { status: 500 });
    }

    // Fetch transactions for the last 90 days
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 90);

    const fmt = (d: Date) => d.toISOString().split("T")[0];

    // Use transactionsGet to fetch all transactions
    let allTransactions: Array<{
      amount: number;
      primary_category?: string | null;
      detailed_category?: string | null;
      merchant_name?: string | null;
      raw_name?: string | null;
    }> = [];

    // Cap at 5000 transactions — enough for accurate spend profiling, avoids Vercel 15s timeout
    const MAX_TRANSACTIONS = 5000;
    let offset = 0;
    let totalTransactions = 1;

    while (offset < totalTransactions && offset < MAX_TRANSACTIONS) {
      const txResp = await client.transactionsGet({
        access_token,
        start_date: fmt(startDate),
        end_date: fmt(endDate),
        options: {
          count: 500,
          offset,
        },
      });

      totalTransactions = txResp.data.total_transactions;
      const transactions = txResp.data.transactions;

      allTransactions = allTransactions.concat(
        transactions
          .filter((tx) => !tx.pending)   // exclude pending — matches analyze-coconut behavior
          .map((tx) => {
            const pfc = tx.personal_finance_category;
            return {
              amount: tx.amount,
              primary_category: pfc?.primary ?? (tx.category?.[0] ?? null),
              detailed_category: pfc?.detailed ?? (tx.category?.[1] ?? null),
              merchant_name: tx.merchant_name ?? null,
              raw_name: tx.name ?? null,
            };
          })
      );

      offset += transactions.length;
      if (transactions.length === 0) break;
    }

    const monthsAnalyzed = 3;
    const spendSummary = categorizeTransactions(allTransactions, monthsAnalyzed);

    // Detect credit cards the user already has via their accounts
    const db = getSupabaseAdmin();
    let detectedCardIds: string[] = [];
    try {
      const [accountsResp, cardsResp] = await Promise.all([
        client.accountsGet({ access_token }),
        db.from("credit_cards").select("id, name, issuer").eq("active", true),
      ]);
      const creditAccounts = accountsResp.data.accounts.filter(
        (a) => a.type === "credit" || a.subtype === "credit card"
      );
      const institution = accountsResp.data.item.institution_id ?? "";
      const institutionName = creditAccounts[0]
        ? (accountsResp.data.item as unknown as { institution_name?: string }).institution_name ?? institution
        : "";
      const accountsForMatching = creditAccounts.map((a) => ({
        name: a.name,
        official_name: a.official_name ?? null,
        institution_name: institutionName,
      }));
      if (accountsForMatching.length > 0 && cardsResp.data) {
        detectedCardIds = matchPlaidAccountsToCards(
          accountsForMatching,
          cardsResp.data as CreditCard[]
        );
      }
    } catch {
      // Non-fatal — detection is best-effort
    }

    // Check if there's an existing session to merge into (user adding a second bank)
    const existingSessionId = request.cookies.get("card_session_id")?.value;
    let finalSpendSummary = spendSummary;
    let sessionId: string;

    if (existingSessionId) {
      const { data: existingSession } = await db
        .from("card_tool_sessions")
        .select("spend_summary")
        .eq("id", existingSessionId)
        .single();

      if (existingSession?.spend_summary) {
        finalSpendSummary = mergeSpendSummaries(
          existingSession.spend_summary as SpendSummary,
          spendSummary
        );
        // Update existing session with merged spend
        const { error: updateError } = await db
          .from("card_tool_sessions")
          .update({ spend_summary: finalSpendSummary })
          .eq("id", existingSessionId);
        if (updateError) {
          console.error("[cards/analyze-plaid] session merge failed:", updateError.message);
          return NextResponse.json({ error: "Failed to merge bank data" }, { status: 500 });
        }
        sessionId = existingSessionId;
        return NextResponse.json({
          session_id: sessionId,
          spend_summary: finalSpendSummary,
          detected_card_ids: detectedCardIds,
        });
      }
    }

    // No existing session — create a new one
    const encryptedToken = encryptToken(access_token);
    const { data: session, error } = await db
      .from("card_tool_sessions")
      .insert({
        plaid_access_token: encryptedToken,
        plaid_item_id: item_id,
        spend_summary: finalSpendSummary,
      })
      .select("id")
      .single();

    if (error || !session) {
      console.error("[cards/analyze-plaid] db insert failed:", error?.message);
      return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
    }

    sessionId = (session as { id: string }).id;

    const response = NextResponse.json({ session_id: sessionId, spend_summary: finalSpendSummary, detected_card_ids: detectedCardIds ?? [] });
    // Set httpOnly session cookie (30 days)
    response.cookies.set("card_session_id", sessionId, {
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
      sameSite: "lax",
    });

    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[cards/analyze-plaid] error:", message);
    return NextResponse.json({ error: "Failed to analyze transactions" }, { status: 500 });
  }
}
