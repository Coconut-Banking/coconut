/**
 * Offboard a user: call Plaid item/remove and delete all their data.
 * Used by: disconnect, wipe, and Clerk user.deleted webhook.
 */
import { getSupabase } from "./supabase";
import { getPlaidClient } from "./plaid-client";

export async function offboardUser(clerkUserId: string, options?: { plaidItemRemove?: boolean }) {
  const db = getSupabase();
  const doPlaidRemove = options?.plaidItemRemove !== false;

  // 1. Plaid item/remove to stop billing
  if (doPlaidRemove) {
    const { data: items } = await db.from("plaid_items").select("access_token").eq("clerk_user_id", clerkUserId);
    const plaid = getPlaidClient();
    if (plaid && items?.length) {
      for (const item of items) {
        const token = item.access_token as string;
        if (!token) continue;
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

  // 5. Delete transactions, accounts, plaid_items
  await db.from("transactions").delete().eq("clerk_user_id", clerkUserId);
  await db.from("accounts").delete().eq("clerk_user_id", clerkUserId);
  await db.from("plaid_items").delete().eq("clerk_user_id", clerkUserId);

  // 6. Subscriptions
  await db.from("subscriptions").delete().eq("clerk_user_id", clerkUserId);

  console.log("[offboard] completed", { user_id: clerkUserId });
}
