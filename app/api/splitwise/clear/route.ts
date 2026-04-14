export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getUserId } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { CACHE_TAGS } from "@/lib/cached-queries";

/**
 * POST /api/splitwise/clear
 *
 * Body options:
 *   { disconnectToken?: boolean }  — legacy: delete Splitwise-imported groups only
 *   { resetAll: true }             — nuclear: delete ALL groups, splits, settlements, members + Splitwise token
 *
 * Bank transactions are never touched.
 */
export async function POST(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let disconnectToken = false;
  let resetAll = false;
  try {
    const body = (await req.json()) as { disconnectToken?: boolean; resetAll?: boolean };
    disconnectToken = Boolean(body?.disconnectToken);
    resetAll = Boolean(body?.resetAll);
  } catch {
    // no body
  }

  const db = getSupabaseAdmin();
  const BATCH = 200;

  async function deleteGroupCascade(gid: string) {
    const { data: splitRows } = await db.from("split_transactions").select("id").eq("group_id", gid);
    const sids = (splitRows ?? []).map((r: { id: string }) => r.id);
    if (sids.length > 0) {
      await Promise.all(
        Array.from({ length: Math.ceil(sids.length / BATCH) }, (_, i) =>
          db.from("split_shares").delete().in("split_transaction_id", sids.slice(i * BATCH, (i + 1) * BATCH))
        )
      );
    }
    await db.from("settlements").delete().eq("group_id", gid);
    await db.from("split_transactions").delete().eq("group_id", gid);
    await db.from("group_members").delete().eq("group_id", gid);
    const { error: delG } = await db.from("groups").delete().eq("id", gid);
    return !delG;
  }

  // Decide which groups to delete
  const groupQuery = db.from("groups").select("id").eq("owner_id", userId);
  if (!resetAll) {
    groupQuery.eq("source", "splitwise");
  }
  const { data: groups, error: listErr } = await groupQuery;

  if (listErr) {
    console.error("[splitwise/clear] list:", listErr.message);
    return NextResponse.json({ error: "Could not list groups" }, { status: 500 });
  }

  const ids = (groups ?? []).map((g) => g.id);
  const results = await Promise.all(ids.map(deleteGroupCascade));
  const deletedGroups = results.filter(Boolean).length;

  if (disconnectToken || resetAll) {
    await db.from("splitwise_tokens").delete().eq("clerk_user_id", userId);
  }

  if (deletedGroups > 0 || resetAll) {
    revalidateTag(CACHE_TAGS.splitTransactions(userId), "max");
  }

  return NextResponse.json({
    ok: true,
    deletedGroups,
    resetAll,
    disconnectToken: disconnectToken || resetAll,
  });
}
