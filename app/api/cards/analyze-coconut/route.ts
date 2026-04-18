/**
 * POST /api/cards/analyze-coconut
 * For existing Coconut users (requires Clerk auth).
 * Fetches their last 3 months of transactions from Supabase, categorizes spend,
 * and creates/updates a card_tool_sessions record.
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { loadClerkAuth } from "@/lib/auth";
import { getEffectiveUserId } from "@/lib/demo";
import { categorizeTransactions, matchPlaidAccountsToCards } from "@/lib/card-recommendations";
import type { CreditCard } from "@/lib/card-recommendations";
import { rateLimit } from "@/lib/rate-limit";

export async function POST() {
  const session = await loadClerkAuth();
  if (!session.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { userId: clerkUserId } = session;
  const effectiveUserId = await getEffectiveUserId({ userId: clerkUserId });
  if (!effectiveUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = rateLimit(`cards-analyze-coconut:${effectiveUserId}`, 10, 60_000);
  if (!rl.success) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const db = getSupabaseAdmin();

  // Fetch last 90 days of transactions
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 90);
  const fmt = (d: Date) => d.toISOString().split("T")[0];

  const { data: transactions, error } = await db
    .from("transactions")
    .select("amount, primary_category, detailed_category, merchant_name, raw_name")
    .eq("clerk_user_id", effectiveUserId)
    .eq("is_pending", false)
    .gte("date", fmt(startDate))
    .lte("date", fmt(endDate))
    .not("plaid_transaction_id", "like", "manual_%")
    .order("date", { ascending: false })
    .limit(2000);

  if (error) {
    console.error("[cards/analyze-coconut] db error:", error.message);
    return NextResponse.json({ error: "Failed to fetch transactions" }, { status: 500 });
  }

  const rows = (transactions ?? []).map((tx) => ({
    amount: -(tx.amount as number),
    primary_category: tx.primary_category as string | null,
    detailed_category: tx.detailed_category as string | null,
    merchant_name: tx.merchant_name as string | null,
    raw_name: tx.raw_name as string | null,
  }));

  const monthsAnalyzed = 3;
  const spendSummary = categorizeTransactions(rows, monthsAnalyzed);

  // Detect credit cards the user already has via their linked Plaid accounts
  let detectedCardIds: string[] = [];
  try {
    const [accountsResp, cardsResp] = await Promise.all([
      db
        .from("accounts")
        .select("name, subtype, plaid_item_id")
        .eq("clerk_user_id", effectiveUserId)
        .eq("type", "credit"),
      db.from("credit_cards").select("id, name, issuer").eq("active", true),
    ]);

    if (accountsResp.data && accountsResp.data.length > 0 && cardsResp.data) {
      // Get institution names for each item
      const itemIds = [...new Set(accountsResp.data.map((a) => a.plaid_item_id).filter(Boolean))];
      const { data: itemsData } = await db
        .from("plaid_items")
        .select("plaid_item_id, institution_name")
        .in("plaid_item_id", itemIds as string[]);
      const instMap = new Map((itemsData ?? []).map((i) => [i.plaid_item_id as string, (i.institution_name as string) ?? ""]));

      const accountsForMatching = accountsResp.data.map((a) => ({
        name: a.name as string,
        official_name: null,
        institution_name: instMap.get(a.plaid_item_id as string) ?? "",
      }));
      detectedCardIds = matchPlaidAccountsToCards(accountsForMatching, cardsResp.data as CreditCard[]);
    }
  } catch {
    // Non-fatal — detection is best-effort
  }

  // Reuse a session from the last 24h only if the user hasn't started the quiz yet
  // (quiz_answers being set means they're mid-flow — overwriting would erase their progress)
  const { data: existingSession } = await db
    .from("card_tool_sessions")
    .select("id")
    .eq("clerk_user_id", effectiveUserId)
    .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .is("quiz_answers", null)
    .maybeSingle();

  let sessionId: string;

  if (existingSession) {
    // Update existing pre-quiz session with fresh spend data
    sessionId = (existingSession as { id: string }).id;
    await db
      .from("card_tool_sessions")
      .update({ spend_summary: spendSummary })
      .eq("id", sessionId);
  } else {
    // Create new session
    const { data: newSession, error: insertError } = await db
      .from("card_tool_sessions")
      .insert({
        clerk_user_id: effectiveUserId,
        spend_summary: spendSummary,
      })
      .select("id")
      .single();

    if (insertError || !newSession) {
      console.error("[cards/analyze-coconut] insert error:", insertError?.message);
      return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
    }
    sessionId = (newSession as { id: string }).id;
  }

  const response = NextResponse.json({ session_id: sessionId, spend_summary: spendSummary, detected_card_ids: detectedCardIds });
  response.cookies.set("card_session_id", sessionId, {
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
    sameSite: "lax",
  });

  return response;
}
