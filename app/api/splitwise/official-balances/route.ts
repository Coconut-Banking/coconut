export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { decryptToken } from "@/lib/encryption";
import { getFriends } from "@/lib/splitwise";

/**
 * GET /api/splitwise/official-balances
 * Raw Splitwise /get_friends balances (per currency) for debugging / comparison with Coconut.
 *
 * Splitwise convention: positive `amount` = they owe you, negative = you owe them.
 * This matches Coconut's summary convention (positive = they owe you).
 */
export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getSupabase();
  const { data: tokenRow } = await db
    .from("splitwise_tokens")
    .select("access_token")
    .eq("clerk_user_id", userId)
    .maybeSingle();

  if (!tokenRow?.access_token) {
    return NextResponse.json(
      { error: "Connect Splitwise first" },
      { status: 400 }
    );
  }

  try {
    const token = decryptToken(tokenRow.access_token);
    const friends = await getFriends(token);
    return NextResponse.json(
      {
        friends: friends.map((f) => ({
          id: f.id,
          first_name: f.first_name,
          last_name: f.last_name,
          email: f.email ?? null,
          balance: (f.balance ?? []).map((b) => ({
            currency_code: b.currency_code,
            amount: b.amount,
          })),
        })),
      },
      {
        headers: {
          "Cache-Control": "private, max-age=60, stale-while-revalidate=300",
        },
      }
    );
  } catch (e) {
    console.error("[official-balances]", e);
    return NextResponse.json({ error: "Failed to load Splitwise balances" }, { status: 500 });
  }
}
