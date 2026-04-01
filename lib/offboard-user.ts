/**
 * Offboard a user: call Plaid item/remove and delete all their data.
 * Used by: disconnect, wipe, and Clerk user.deleted webhook.
 */
import { getSupabase } from "./supabase";
import { getPlaidClient } from "./plaid-client";
import { decryptToken } from "./encryption";

export async function offboardUser(clerkUserId: string, options?: { plaidItemRemove?: boolean }) {
  const db = getSupabase();
  const doPlaidRemove = options?.plaidItemRemove !== false;

  // 1. Plaid item/remove to stop billing
  if (doPlaidRemove) {
    const { data: items } = await db.from("plaid_items").select("access_token").eq("clerk_user_id", clerkUserId);
    const plaid = getPlaidClient();
    if (plaid && items?.length) {
      for (const item of items) {
        const raw = item.access_token as string;
        if (!raw) continue;
        const token = decryptToken(raw);
        try {
          await plaid.itemRemove({ access_token: token });
          console.log("[offboard] itemRemove ok", { user_id: clerkUserId });
        } catch (e) {
          console.warn("[offboard] itemRemove failed:", e instanceof Error ? e.message : e);
        }
      }
    }
  }

  // 2. Delete groups owned by user (cascades to members, splits, settlements)
  await db.from("groups").delete().eq("owner_id", clerkUserId);

  // 3a. Delete settlements referencing this user's member rows to avoid FK RESTRICT violation
  const { data: foreignMemberRows } = await db
    .from("group_members")
    .select("id")
    .eq("user_id", clerkUserId);
  if (foreignMemberRows?.length) {
    const memberIds = foreignMemberRows.map((m: { id: string }) => m.id);
    await db.from("settlements").delete().in("payer_member_id", memberIds);
    await db.from("settlements").delete().in("receiver_member_id", memberIds);
  }

  // 3. Remove user from groups they're in but don't own
  await db.from("group_members").delete().eq("user_id", clerkUserId);

  // 4. Gmail / email — must clear email_receipts.transaction_id FK before deleting transactions
  try {
    await db.from("email_receipts").update({ transaction_id: null }).eq("clerk_user_id", clerkUserId);
    await db.from("email_receipts").delete().eq("clerk_user_id", clerkUserId);
    await db.from("gmail_connections").delete().eq("clerk_user_id", clerkUserId);
    await db.from("gmail_scan_log").delete().eq("clerk_user_id", clerkUserId);
  } catch {
    // Tables may not exist
  }

  // 5. Subscriptions (delete join table first to avoid orphaned rows)
  const { data: userSubs } = await db.from("subscriptions").select("id").eq("clerk_user_id", clerkUserId);
  if (userSubs?.length) {
    await db.from("subscription_transactions").delete().in("subscription_id", userSubs.map(s => s.id));
  }
  await db.from("subscriptions").delete().eq("clerk_user_id", clerkUserId);

  // 5b. Clear any remaining subscription_transactions rows referencing this user's
  //     transactions by transaction_id FK (may exist if subscription_id was null
  //     or belonged to a different subscription record). Must happen before
  //     deleting transactions to avoid ON DELETE RESTRICT FK violations.
  const { data: userTxIds } = await db
    .from("transactions")
    .select("id")
    .eq("clerk_user_id", clerkUserId);
  if (userTxIds?.length) {
    await db
      .from("subscription_transactions")
      .delete()
      .in("transaction_id", userTxIds.map((r: { id: string }) => r.id));
  }

  // 6. Delete transactions, accounts, plaid_items
  await db.from("transactions").delete().eq("clerk_user_id", clerkUserId);
  await db.from("accounts").delete().eq("clerk_user_id", clerkUserId);
  await db.from("plaid_items").delete().eq("clerk_user_id", clerkUserId);

  console.log("[offboard] completed", { user_id: clerkUserId });
}
