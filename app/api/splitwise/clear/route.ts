export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getUserId } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { CACHE_TAGS } from "@/lib/cached-queries";

/**
 * POST /api/splitwise/clear
 * Deletes all groups you own that came from Splitwise import (members, splits, settlements).
 * Optional body: { disconnectToken: true } — also removes stored Splitwise OAuth token.
 */
export async function POST(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let disconnectToken = false;
  try {
    const body = (await req.json()) as { disconnectToken?: boolean };
    disconnectToken = Boolean(body?.disconnectToken);
  } catch {
    // no body
  }

  const db = getSupabaseAdmin();

  const { data: swGroups, error: listErr } = await db
    .from("groups")
    .select("id")
    .eq("owner_id", userId)
    .eq("source", "splitwise");

  if (listErr) {
    console.error("[splitwise/clear] list:", listErr.message);
    return NextResponse.json({ error: "Could not list imported groups" }, { status: 500 });
  }

  const ids = (swGroups ?? []).map((g) => g.id);
  let deletedGroups = 0;

  const BATCH = 200;
  for (const gid of ids) {
    const { data: splitRows } = await db.from("split_transactions").select("id").eq("group_id", gid);
    const sids = (splitRows ?? []).map((r) => r.id);
    if (sids.length > 0) {
      for (let i = 0; i < sids.length; i += BATCH) {
        await db.from("split_shares").delete().in("split_transaction_id", sids.slice(i, i + BATCH));
      }
    }
    await db.from("split_transactions").delete().eq("group_id", gid);
    await db.from("group_members").delete().eq("group_id", gid);
    const { error: delG } = await db.from("groups").delete().eq("id", gid);
    if (!delG) deletedGroups += 1;
  }

  if (disconnectToken) {
    await db.from("splitwise_tokens").delete().eq("clerk_user_id", userId);
  }

  if (deletedGroups > 0) {
    revalidateTag(CACHE_TAGS.splitTransactions(userId), "max");
  }

  return NextResponse.json({
    ok: true,
    deletedSplitwiseGroups: deletedGroups,
    disconnectToken,
  });
}
