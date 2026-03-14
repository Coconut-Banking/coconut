import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getEffectiveUserId } from "@/lib/demo";
import { getPlaidClient } from "@/lib/plaid-client";

/**
 * POST /api/plaid/disconnect
 * Removes Plaid connection and all bank transactions for the user.
 * Calls Plaid item/remove per Item to stop billing and invalidate tokens.
 */
export async function POST() {
  const effectiveUserId = await getEffectiveUserId();
  if (!effectiveUserId) {
    return NextResponse.json({ error: "Sign in to manage your bank" }, { status: 401 });
  }

  try {
    const db = getSupabase();

    // Call item/remove so Plaid stops billing
    const { data: items } = await db.from("plaid_items").select("access_token").eq("clerk_user_id", effectiveUserId);
    const plaid = getPlaidClient();
    if (plaid && items?.length) {
      for (const item of items) {
        const token = item.access_token as string;
        if (!token) continue;
        try {
          await plaid.itemRemove({ access_token: token });
          console.log("[disconnect] itemRemove ok", { user_id: effectiveUserId });
        } catch (e) {
          console.warn("[disconnect] itemRemove failed (token may be invalid):", e instanceof Error ? e.message : e);
        }
      }
    }

    // Delete only bank transactions (keep manual expenses from Shared)
    const { data: allTx } = await db
      .from("transactions")
      .select("id, plaid_transaction_id")
      .eq("clerk_user_id", effectiveUserId);
    const bankIds = (allTx ?? [])
      .filter((r) => !String(r.plaid_transaction_id || "").startsWith("manual_"))
      .map((r) => r.id);
    if (bankIds.length > 0) {
      await db.from("transactions").delete().in("id", bankIds);
    }

    // Delete accounts and plaid_items
    await db.from("accounts").delete().eq("clerk_user_id", effectiveUserId);
    const { error } = await db.from("plaid_items").delete().eq("clerk_user_id", effectiveUserId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[disconnect]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Disconnect failed" }, { status: 500 });
  }
}
