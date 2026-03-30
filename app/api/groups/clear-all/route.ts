export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/groups/clear-all
 * Nuclear option: deletes ALL groups the user owns (Splitwise + manual),
 * including their members, split transactions, shares, and settlements.
 * Also clears Splitwise tokens/cache.
 */
export async function POST() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getSupabaseAdmin();

  const { data: groups, error: listErr } = await db
    .from("groups")
    .select("id")
    .eq("owner_id", userId);

  if (listErr) {
    console.error("[clear-all] list:", listErr.message);
    return NextResponse.json({ error: "Could not list groups" }, { status: 500 });
  }

  const ids = (groups ?? []).map((g) => g.id);
  let deleted = 0;

  for (const gid of ids) {
    const { data: splitRows } = await db.from("split_transactions").select("id").eq("group_id", gid);
    const sids = (splitRows ?? []).map((r) => r.id);
    if (sids.length > 0) {
      await db.from("split_shares").delete().in("split_transaction_id", sids);
    }
    await db.from("split_transactions").delete().eq("group_id", gid);
    await db.from("settlements").delete().eq("group_id", gid);
    await db.from("group_members").delete().eq("group_id", gid);
    const { error: delG } = await db.from("groups").delete().eq("id", gid);
    if (!delG) deleted += 1;
  }

  // Also clear Splitwise tokens
  await db.from("splitwise_tokens").delete().eq("clerk_user_id", userId);

  // Clear any receipt scans owned by this user
  await db.from("receipt_scans").delete().eq("clerk_user_id", userId);

  return NextResponse.json({ ok: true, deletedGroups: deleted });
}
