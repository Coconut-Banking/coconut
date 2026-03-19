export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getEffectiveUserId } from "@/lib/demo";

/**
 * POST /api/plaid/clear-alerts
 * Clears needs_reauth and new_accounts_available for the user's plaid_items.
 * Call when user completes update mode or dismisses prompts.
 */
export async function POST() {
  const effectiveUserId = await getEffectiveUserId();
  if (!effectiveUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getSupabase();
    const { error } = await db
      .from("plaid_items")
      .update({ needs_reauth: false, new_accounts_available: false })
      .eq("clerk_user_id", effectiveUserId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true }); // Columns may not exist; ack to not block UI
  }
}
