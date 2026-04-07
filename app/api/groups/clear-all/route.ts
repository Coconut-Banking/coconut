export const dynamic = "force-dynamic";

import { currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/groups/clear-all
 * Nuclear reset: wipes ALL user data — groups, splits, settlements, memberships,
 * Splitwise, PayPal, Gmail, subscriptions, receipts, push tokens, recurring
 * expenses, manual accounts, p2p annotations, and scan logs.
 */
export async function POST() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await currentUser().catch(() => null);
  const email = user?.emailAddresses?.[0]?.emailAddress?.toLowerCase().trim();
  if (!email) {
    console.warn("[clear-all] Could not fetch Clerk user email — email-matched members will not be unlinked for userId:", userId);
  }

  const db = getSupabaseAdmin();
  const log: string[] = [];

  const safeDelete = async (table: string, filter: { col: string; val: string }) => {
    try {
      const { count, error } = await db.from(table).delete({ count: "exact" }).eq(filter.col, filter.val);
      if (error) log.push(`${table}: err ${error.message}`);
      else log.push(`${table}: ${count ?? 0}`);
      return count ?? 0;
    } catch {
      log.push(`${table}: skipped (table may not exist)`);
      return 0;
    }
  };

  // 1. Splitwise tokens
  await safeDelete("splitwise_tokens", { col: "clerk_user_id", val: userId });

  // 2. Find + delete owned groups (with all children)
  const { data: ownedGroups } = await db
    .from("groups")
    .select("id")
    .eq("owner_id", userId);
  const ownedIds = (ownedGroups ?? []).map((g) => g.id);
  log.push(`owned groups: ${ownedIds.length}`);

  let deletedGroups = 0;
  for (const gid of ownedIds) {
    const { data: splitRows } = await db.from("split_transactions").select("id").eq("group_id", gid);
    const sids = (splitRows ?? []).map((r) => r.id);
    if (sids.length > 0) {
      await db.from("split_shares").delete().in("split_transaction_id", sids);
    }
    await db.from("split_transactions").delete().eq("group_id", gid);
    await db.from("settlements").delete().eq("group_id", gid);
    await db.from("group_members").delete().eq("group_id", gid);
    const { error: delG } = await db.from("groups").delete().eq("id", gid);
    if (!delG) deletedGroups += 1;
  }
  log.push(`groups deleted: ${deletedGroups}`);

  // 3. Remove from foreign groups
  const { count: foreignByUserId } = await db
    .from("group_members")
    .delete({ count: "exact" })
    .eq("user_id", userId);
  log.push(`foreign members: ${foreignByUserId ?? 0}`);

  // 4. Unlink email-matched members in other users' groups
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

  // 5. All remaining data tables (order matters for FK constraints)
  await safeDelete("receipt_scans", { col: "clerk_user_id", val: userId });
  await safeDelete("recurring_expenses", { col: "clerk_user_id", val: userId });
  await safeDelete("manual_accounts", { col: "clerk_user_id", val: userId });
  await safeDelete("p2p_annotations", { col: "clerk_user_id", val: userId });
  await safeDelete("push_tokens", { col: "clerk_user_id", val: userId });
  await safeDelete("stripe_connected_accounts", { col: "clerk_user_id", val: userId });
  await safeDelete("gmail_scan_log", { col: "clerk_user_id", val: userId });
  await safeDelete("paypal_connections", { col: "clerk_user_id", val: userId });

  console.log("[clear-all]", userId, log.join(" | "));

  return NextResponse.json({
    ok: true,
    deletedGroups,
    foreignMembershipsRemoved: foreignByUserId ?? 0,
    log,
  });
}
