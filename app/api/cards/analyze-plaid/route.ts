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
import { categorizeTransactions } from "@/lib/card-recommendations";
import { rateLimit } from "@/lib/rate-limit";

type AnalyzePlaidBody = {
  public_token?: string;
};

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

    let offset = 0;
    let totalTransactions = 1;

    while (offset < totalTransactions) {
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
        transactions.map((tx) => {
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

    // Encrypt the access token for storage
    const encryptedToken = encryptToken(access_token);

    // Create card_tool_sessions record
    const db = getSupabaseAdmin();
    const { data: session, error } = await db
      .from("card_tool_sessions")
      .insert({
        plaid_access_token: encryptedToken,
        plaid_item_id: item_id,
        spend_summary: spendSummary,
      })
      .select("id")
      .single();

    if (error || !session) {
      console.error("[cards/analyze-plaid] db insert failed:", error?.message);
      return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
    }

    const sessionId = (session as { id: string }).id;

    const response = NextResponse.json({ session_id: sessionId, spend_summary: spendSummary });
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
