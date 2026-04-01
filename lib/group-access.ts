import { currentUser } from "@clerk/nextjs/server";
import { getSupabase } from "./supabase";

/**
 * Link group members by email when user signs in.
 * When a user logs in, find ALL group_members rows that match their email
 * but have no user_id yet, and link them. This is how User B gains access
 * to a group that User A created and added them to by email.
 */
async function linkMemberByEmail(userId: string) {
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress;
  if (!email) return;

  const db = getSupabase();

  const { data: candidates } = await db
    .from("group_members")
    .select("id, group_id")
    .eq("email", email.toLowerCase())
    .is("user_id", null);

  if (!candidates || candidates.length === 0) return;

  for (const member of candidates) {
    await db
      .from("group_members")
      .update({ user_id: userId })
      .eq("id", member.id);
  }

  console.log(
    `[group-access] linked ${candidates.length} member row(s) for ${email}`
  );
}

/**
 * Check if user can access a group (owner or member with user_id).
 */
export async function canAccessGroup(
  userId: string,
  groupId: string
): Promise<boolean> {
  const db = getSupabase();
  const { data: group, error } = await db.from("groups").select("owner_id").eq("id", groupId).single();
  if (error || !group) return false;
  if (group.owner_id === userId) return true;

  const { data: member } = await db
    .from("group_members")
    .select("id")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .maybeSingle();

  return !!member;
}

/**
 * Get all group IDs the user can access (as owner or member).
 * Links members by email when they sign in (so invited users see groups).
 */
export async function getAccessibleGroupIds(userId: string): Promise<string[]> {
  await linkMemberByEmail(userId);

  const db = getSupabase();

  const { data: owned, error: ownedErr } = await db.from("groups").select("id").eq("owner_id", userId);
  const { data: memberRows, error: memberErr } = await db
    .from("group_members")
    .select("group_id")
    .eq("user_id", userId);

  console.log("[group-access] userId:", userId, "owned:", owned?.length ?? 0, "ownedErr:", ownedErr?.message, "memberRows:", memberRows?.length ?? 0, "memberErr:", memberErr?.message);

  const ids = new Set<string>();
  for (const g of owned ?? []) ids.add(g.id);
  for (const r of memberRows ?? []) if (r.group_id) ids.add(r.group_id);

  return Array.from(ids);
}
