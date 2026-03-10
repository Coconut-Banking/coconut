import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";

const DEMO_USER_ID = "demo-sandbox-user";

/**
 * POST /api/plaid/disconnect
 * Removes Plaid connection and all bank transactions for the user.
 * Uses same effectiveUserId as status/exchange (userId ?? DEMO_USER_ID) so
 * disconnect actually deletes the same data that was linked.
 */
export async function POST() {
  const { userId } = await auth();
  // Production: require real auth, never use demo/sandbox user
  const effectiveUserId =
    userId ?? (process.env.NODE_ENV === "production" ? null : DEMO_USER_ID);
  if (!effectiveUserId) {
    return NextResponse.json({ error: "Sign in to manage your bank" }, { status: 401 });
  }

  const db = getSupabase();

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

  // Delete accounts
  await db.from("accounts").delete().eq("clerk_user_id", effectiveUserId);

  // Delete plaid_items (the Plaid access token)
  const { error } = await db.from("plaid_items").delete().eq("clerk_user_id", effectiveUserId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
