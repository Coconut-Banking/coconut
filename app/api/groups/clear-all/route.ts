export const dynamic = "force-dynamic";

import { currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/groups/clear-all
 * Nuclear option: deletes ALL the user's data — owned groups (with children),
 * foreign memberships, email-based member rows in other users' groups,
 * Splitwise tokens/cache, and receipt scans.
 */
export async function POST() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await currentUser().catch(() => null);
  const email = user?.emailAddresses?.[0]?.emailAddress?.toLowerCase().trim();
  if (!email) {
    if (process.env.NODE_ENV === 'development') console.warn("[clear-all] Could not fetch Clerk user email for step 5 — email-matched members will not be unlinked for userId:", userId);
  }

  const db = getSupabaseAdmin();
  const log: string[] = [];

  // 1. Delete Splitwise tokens FIRST (prevents cached balances from re-appearing)
  const { error: tokenErr, count: tokenCount } = await db
    .from("splitwise_tokens")
    .delete({ count: "exact" })
    .eq("clerk_user_id", userId);
  log.push(`splitwise_tokens: deleted ${tokenCount ?? 0}${tokenErr ? ` (err: ${tokenErr.message})` : ""}`);

  // 2. Find all groups this user owns
  const { data: ownedGroups } = await db
    .from("groups")
    .select("id")
    .eq("owner_id", userId);
  const ownedIds = (ownedGroups ?? []).map((g) => g.id);
  log.push(`owned groups: ${ownedIds.length}`);

  // 3. Delete children of owned groups
  let deletedGroups = 0;
  for (const gid of ownedIds) {
    const { data: splitRows } = await db.from("split_transactions").select("id").eq("group_id", gid);
    const sids = (splitRows ?? []).map((r) => r.id);
    if (sids.length > 0) {
      const { error: shareErr } = await db.from("split_shares").delete().in("split_transaction_id", sids);
      if (shareErr) log.push(`split_shares err (group ${gid}): ${shareErr.message}`);
    }
    await db.from("split_transactions").delete().eq("group_id", gid);
    await db.from("settlements").delete().eq("group_id", gid);
    await db.from("group_members").delete().eq("group_id", gid);
    const { error: delG } = await db.from("groups").delete().eq("id", gid);
    if (delG) log.push(`group delete err ${gid}: ${delG.message}`);
    else deletedGroups += 1;
  }
  log.push(`groups deleted: ${deletedGroups}`);

  // 4. Remove ALL member rows where user_id = userId (foreign groups)
  const { count: foreignByUserId } = await db
    .from("group_members")
    .delete({ count: "exact" })
    .eq("user_id", userId);
  log.push(`foreign members (by user_id): ${foreignByUserId ?? 0}`);

  // 5. Also null-out user_id on member rows matching user's email in
  //    non-owned groups. This prevents linkMemberByEmail from re-linking
  //    on the next request. We set user_id to null so the row stays for
  //    the group owner but stops being accessible to this user.
  if (email) {
    const { data: emailMembers } = await db
      .from("group_members")
      .select("id")
      .eq("email", email);
    const emailMemberIds = (emailMembers ?? []).map((m) => m.id);
    if (emailMemberIds.length > 0) {
      for (const mid of emailMemberIds) {
        await db.from("group_members").update({ user_id: null }).eq("id", mid);
      }
    }
    log.push(`email members nulled: ${emailMemberIds.length}`);
  }

  // 6. Clear receipt scans
  const { count: receiptCount } = await db
    .from("receipt_scans")
    .delete({ count: "exact" })
    .eq("clerk_user_id", userId);
  log.push(`receipt_scans: ${receiptCount ?? 0}`);

  if (process.env.NODE_ENV === 'development') console.log("[clear-all]", userId, log.join(" | "));

  return NextResponse.json({
    ok: true,
    deletedGroups,
    foreignMembershipsRemoved: foreignByUserId ?? 0,
    log,
  });
}
