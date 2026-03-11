import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getEffectiveUserId } from "@/lib/demo";

/**
 * POST /api/plaid/wipe
 * Nuclear option: deletes ALL data for the user (transactions, accounts, plaid, subscriptions).
 * Use when you want to start completely fresh before relinking.
 */
export async function POST() {
  const effectiveUserId = await getEffectiveUserId();
  if (!effectiveUserId) {
    return NextResponse.json({ error: "Sign in to wipe data" }, { status: 401 });
  }

  try {
  const db = getSupabase();

  // Delete ALL transactions (manual + bank)
  const { error: txErr } = await db
    .from("transactions")
    .delete()
    .eq("clerk_user_id", effectiveUserId);
  if (txErr) {
    return NextResponse.json({ error: txErr.message }, { status: 500 });
  }

  // Delete accounts
  await db.from("accounts").delete().eq("clerk_user_id", effectiveUserId);

  // Delete plaid_items
  await db.from("plaid_items").delete().eq("clerk_user_id", effectiveUserId);

  // Delete subscriptions
  await db.from("subscriptions").delete().eq("clerk_user_id", effectiveUserId);

  return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[wipe]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Wipe failed" }, { status: 500 });
  }
}
