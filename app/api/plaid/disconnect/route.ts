import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";

/**
 * POST /api/plaid/disconnect
 * Removes Plaid connection and all bank transactions for the user.
 * User must re-connect at /connect to get a fresh token (production if PLAID_ENV=production).
 */
export async function POST() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getSupabase();

  // Delete only bank transactions (keep manual expenses from Shared)
  const { data: allTx } = await db
    .from("transactions")
    .select("id, plaid_transaction_id")
    .eq("clerk_user_id", userId);
  const bankIds = (allTx ?? [])
    .filter((r) => !String(r.plaid_transaction_id || "").startsWith("manual_"))
    .map((r) => r.id);
  if (bankIds.length > 0) {
    await db.from("transactions").delete().in("id", bankIds);
  }

  // Delete accounts
  await db.from("accounts").delete().eq("clerk_user_id", userId);

  // Delete plaid_items (the Plaid access token)
  const { error } = await db.from("plaid_items").delete().eq("clerk_user_id", userId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
