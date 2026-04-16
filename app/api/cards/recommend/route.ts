/**
 * POST /api/cards/recommend
 * Body: { session_id, quiz_answers }
 * Loads session, fetches active credit cards, runs recommendation engine,
 * updates session with recommendations, returns ranked results with full card details.
 */
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getCardRecommendations } from "@/lib/card-recommendations";
import type { QuizAnswers, CreditCard, SpendProfile } from "@/lib/card-recommendations";
import { rateLimit } from "@/lib/rate-limit";

type RecommendBody = {
  quiz_answers?: QuizAnswers;
};

export async function POST(request: NextRequest) {
  // Session ID comes only from the httpOnly cookie — never from the request body
  // (accepting it from the body would allow any caller to read another user's spend data)
  const sessionId = request.cookies.get("card_session_id")?.value;
  if (!sessionId) {
    return NextResponse.json({ error: "session_id required" }, { status: 400 });
  }

  let body: RecommendBody;
  try {
    body = (await request.json()) as RecommendBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const quizAnswers = body.quiz_answers;
  if (!quizAnswers) {
    return NextResponse.json({ error: "quiz_answers required" }, { status: 400 });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = rateLimit(`cards-recommend:${ip}`, 20, 60_000);
  if (!rl.success) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const db = getSupabaseAdmin();

  // Load session
  const { data: session, error: sessionError } = await db
    .from("card_tool_sessions")
    .select("id, spend_summary, expires_at")
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionError || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const sessionData = session as {
    id: string;
    spend_summary: SpendProfile & { total: number; months_analyzed: number };
    expires_at: string;
  };

  // Check expiry
  if (new Date(sessionData.expires_at) < new Date()) {
    return NextResponse.json({ error: "Session expired" }, { status: 410 });
  }

  const spendSummary = sessionData.spend_summary;
  if (!spendSummary) {
    return NextResponse.json({ error: "No spend data for this session" }, { status: 400 });
  }

  // Fetch all active credit cards
  const { data: cardsData, error: cardsError } = await db
    .from("credit_cards")
    .select("*")
    .eq("active", true);

  if (cardsError) {
    console.error("[cards/recommend] cards fetch error:", cardsError.message);
    return NextResponse.json({ error: "Failed to fetch card data" }, { status: 500 });
  }

  const cards = (cardsData ?? []) as CreditCard[];

  // Run recommendation engine
  const recommendations = getCardRecommendations(cards, spendSummary, quizAnswers);

  // Build full card details for response
  const cardMap = new Map(cards.map((c) => [c.id, c]));
  const results = recommendations.map((rec) => ({
    ...rec,
    card: cardMap.get(rec.card_id) ?? null,
  }));

  // Persist quiz_answers and recommendations to session (best-effort — non-fatal)
  const { error: updateError } = await db
    .from("card_tool_sessions")
    .update({
      quiz_answers: quizAnswers,
      recommendations: recommendations,
    })
    .eq("id", sessionId);
  if (updateError) {
    console.error("[cards/recommend] session update failed:", updateError.message);
  }

  return NextResponse.json({ recommendations: results, session_id: sessionId });
}
