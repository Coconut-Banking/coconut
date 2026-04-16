/**
 * GET /api/cards/list
 * Returns all active credit cards (for the existing cards multi-select in the quiz).
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function GET() {
  const db = getSupabaseAdmin();

  const { data, error } = await db
    .from("credit_cards")
    .select("id, name, issuer, network, annual_fee, active")
    .eq("active", true)
    .order("issuer", { ascending: true })
    .order("annual_fee", { ascending: false });

  if (error) {
    console.error("[cards/list] error:", error.message);
    return NextResponse.json({ error: "Failed to fetch cards" }, { status: 500 });
  }

  return NextResponse.json({ cards: data ?? [] });
}
