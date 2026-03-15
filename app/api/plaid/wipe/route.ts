import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getSupabase } from "@/lib/supabase";
import { getEffectiveUserId } from "@/lib/demo";
import { getPlaidClient } from "@/lib/plaid-client";
import { CACHE_TAGS } from "@/lib/cached-queries";

/**
 * POST /api/plaid/wipe
 * Nuclear option: deletes ALL data for the user (transactions, accounts, plaid, subscriptions).
 * Calls Plaid item/remove per Item before deleting to stop billing.
 */
export async function POST() {
  const effectiveUserId = await getEffectiveUserId();
  if (!effectiveUserId) {
    return NextResponse.json({ error: "Sign in to wipe data" }, { status: 401 });
  }

  try {
    const db = getSupabase();

    // Call item/remove so Plaid stops billing before we delete
    const { data: items } = await db.from("plaid_items").select("access_token").eq("clerk_user_id", effectiveUserId);
    const plaid = getPlaidClient();
    if (plaid && items?.length) {
      for (const item of items) {
        const token = item.access_token as string;
        if (!token) continue;
        try {
          await plaid.itemRemove({ access_token: token });
          console.log("[wipe] itemRemove ok", { user_id: effectiveUserId });
        } catch (e) {
          console.warn("[wipe] itemRemove failed:", e instanceof Error ? e.message : e);
        }
      }
    }

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

  revalidateTag(CACHE_TAGS.transactions(effectiveUserId), "max");

  return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[wipe]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Wipe failed" }, { status: 500 });
  }
}
