export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { decryptToken } from "@/lib/encryption";
import { getGroups, getExpenses, getCurrentUser, deleteSwExpense } from "@/lib/splitwise";

/**
 * POST /api/splitwise/shadow-reset
 *
 * Deletes all existing "Mirror ..." groups from Splitwise and clears the
 * mirror map. Next shadow write will create fresh mirrors with phantom members.
 */
export async function POST(req: Request) {
  const authHeader = req.headers.get("x-admin-key");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = new URL(req.url);
  const adminUserId = url.searchParams.get("user_id");

  let userId: string | null;
  if (authHeader && serviceKey && authHeader === serviceKey && adminUserId) {
    userId = adminUserId;
  } else {
    userId = await getUserId();
  }
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getSupabase();

  const { data: tokenRow } = await db
    .from("splitwise_tokens")
    .select("access_token, shadow_mirror_map")
    .eq("clerk_user_id", userId)
    .maybeSingle();

  if (!tokenRow?.access_token) {
    return NextResponse.json({ error: "No Splitwise token" }, { status: 400 });
  }

  const token = decryptToken(tokenRow.access_token);
  const swUser = await getCurrentUser(token);

  // Find all mirror groups
  const allGroups = await getGroups(token);
  const mirrorGroups = allGroups.filter((g) => g.name.startsWith("Mirror "));

  const results: { id: number; name: string; status: string; detail?: string }[] = [];

  for (const mg of mirrorGroups) {
    try {
      // Delete all expenses first to clear balances
      const expenses = await getExpenses(token, mg.id, { maxPages: 100 });
      let deleted = 0;
      for (const exp of expenses) {
        try {
          await deleteSwExpense(token, exp.id);
          deleted++;
        } catch {
          // May already be deleted
        }
      }

      // Now leave the group
      const res = await fetch("https://secure.splitwise.com/api/v3.0/remove_user_from_group", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ group_id: mg.id, user_id: swUser.id }),
      });
      const resBody = await res.json();
      if (resBody.success === false) {
        results.push({ id: mg.id, name: mg.name, status: "cannot_leave", detail: `Deleted ${deleted} expenses but still can't leave: ${JSON.stringify(resBody.errors)}` });
      } else {
        results.push({ id: mg.id, name: mg.name, status: "left", detail: `Deleted ${deleted} expenses, then left group` });
      }
    } catch (e) {
      results.push({ id: mg.id, name: mg.name, status: "error", detail: String(e) });
    }
  }

  // Clear the mirror map
  try {
    await db
      .from("splitwise_tokens")
      .update({ shadow_mirror_map: {} } as Record<string, unknown>)
      .eq("clerk_user_id", userId);
  } catch {
    // Column may not exist
  }

  // Also clear split_transactions that have source=splitwise_mirror
  // so they don't try to update/delete non-existent mirror expenses
  const { data: resetRows } = await db
    .from("split_transactions")
    .update({ external_id: null, source: "manual" } as Record<string, unknown>)
    .eq("source", "splitwise_mirror")
    .select("id");
  const count = resetRows?.length ?? 0;

  return NextResponse.json({
    mirrorGroupsProcessed: results.length,
    results,
    mirrorMapCleared: true,
    splitTransactionsReset: count ?? 0,
  });
}
