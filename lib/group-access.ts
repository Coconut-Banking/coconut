import { currentUser } from "@clerk/nextjs/server";
import { getSupabase } from "./supabase";

const _linkCache = new Map<string, number>();
const LINK_CACHE_TTL_MS = 60_000;

/**
 * Link group members by email when user signs in.
 * Cached per-user for 60s to avoid redundant Clerk + DB calls on every request.
 */
async function linkMemberByEmail(userId: string) {
  const now = Date.now();
  const lastRun = _linkCache.get(userId);
  if (lastRun && now - lastRun < LINK_CACHE_TTL_MS) return;

  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress;
  if (!email) {
    _linkCache.set(userId, now);
    return;
  }

  const db = getSupabase();

  const { data: candidates } = await db
    .from("group_members")
    .select("id, group_id")
    .eq("email", email.toLowerCase())
    .is("user_id", null);

  if (!candidates || candidates.length === 0) {
    _linkCache.set(userId, now);
    return;
  }

  await Promise.all(
    candidates.map((member) =>
      db.from("group_members").update({ user_id: userId }).eq("id", member.id)
    )
  );

  console.log(
    `[group-access] linked ${candidates.length} member row(s) for ${email}`
  );
  _linkCache.set(userId, now);
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
  const db = getSupabase();

  // Link first, THEN query — avoids race where linking completes after
  // the member query, causing a new user to miss their groups on first load.
  await linkMemberByEmail(userId);

  // Single RPC call replaces two parallel queries (owned + member).
  // Falls back to the two-query path if the function doesn't exist yet.
  const { data: rpcRows, error: rpcErr } = await db.rpc(
    "get_accessible_group_ids",
    { p_user_id: userId }
  );

  if (!rpcErr && Array.isArray(rpcRows)) {
    console.log("[group-access] userId:", userId, "rpc ids:", rpcRows.length);
    return rpcRows as string[];
  }

  // Fallback: two-query path (pre-migration or RPC not deployed yet)
  if (rpcErr) {
    console.warn("[group-access] RPC fallback:", rpcErr.message);
  }

  const [ownedRes, memberRes] = await Promise.all([
    db.from("groups").select("id").eq("owner_id", userId),
    db.from("group_members").select("group_id").eq("user_id", userId),
  ]);

  const { data: owned } = ownedRes;
  const { data: memberRows } = memberRes;

  console.log("[group-access] userId:", userId, "owned:", owned?.length ?? 0, "memberRows:", memberRows?.length ?? 0);

  const ids = new Set<string>();
  for (const g of owned ?? []) ids.add(g.id);
  for (const r of memberRows ?? []) if (r.group_id) ids.add(r.group_id);

  return Array.from(ids);
}
