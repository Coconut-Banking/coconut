import { currentUser } from "@clerk/nextjs/server";
import { getSupabase } from "./supabase";

/**
 * Link group members by email when user signs in (owner invited them by email).
 */
async function linkMemberByEmail(userId: string) {
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress;
  if (!email) return;

  const db = getSupabase();
  await db
    .from("group_members")
    .update({ user_id: userId })
    .eq("email", email)
    .is("user_id", null);
}

/**
 * Check if user can access a group (owner or member with user_id).
 */
export async function canAccessGroup(
  userId: string,
  groupId: string
): Promise<boolean> {
  const db = getSupabase();
  const { data: group } = await db.from("groups").select("owner_id").eq("id", groupId).single();
  if (!group) return false;
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

  const { data: owned } = await db.from("groups").select("id").eq("owner_id", userId);
  const { data: memberRows } = await db
    .from("group_members")
    .select("group_id")
    .eq("user_id", userId);

  const ids = new Set<string>();
  for (const g of owned ?? []) ids.add(g.id);
  for (const r of memberRows ?? []) if (r.group_id) ids.add(r.group_id);

  return Array.from(ids);
}
