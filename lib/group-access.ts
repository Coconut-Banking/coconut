import { currentUser } from "@clerk/nextjs/server";
import { getSupabase } from "./supabase";

const _linkedUserIds = new Map<string, number>();
const LINK_TTL_MS = 300_000; // Re-check email linking every 5 minutes

/**
 * Link group members by email when user signs in.
 * Cached per-user for 5 minutes to avoid redundant Clerk + DB calls.
 */
async function linkMemberByEmail(userId: string) {
  const lastLinked = _linkedUserIds.get(userId);
  if (lastLinked && Date.now() - lastLinked < LINK_TTL_MS) return;

  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress;
  if (!email) {
    _linkedUserIds.set(userId, Date.now());
    return;
  }

  const db = getSupabase();

  const { data: candidates } = await db
    .from("group_members")
    .select("id, group_id")
    .eq("email", email.toLowerCase())
    .is("user_id", null);

  if (!candidates || candidates.length === 0) {
    _linkedUserIds.set(userId, Date.now());
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
  _linkedUserIds.add(userId);
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

const _idsCache = new Map<string, { ids: string[]; ts: number }>();
const IDS_CACHE_TTL_MS = 60_000;

/**
 * Get all group IDs the user can access (as owner or member).
 * Links members by email when they first sign in (so invited users see groups).
 * Results are cached for 60s per userId.
 */
export async function getAccessibleGroupIds(userId: string): Promise<string[]> {
  const now = Date.now();
  const cached = _idsCache.get(userId);
  if (cached && now - cached.ts < IDS_CACHE_TTL_MS) {
    return cached.ids;
  }

  // Link member by email (cached per-user with TTL)
  await linkMemberByEmail(userId);

  const db = getSupabase();

  const [ownedRes, memberRes] = await Promise.all([
    db.from("groups").select("id").eq("owner_id", userId),
    db.from("group_members").select("group_id").eq("user_id", userId),
  ]);

  const { data: owned, error: ownedErr } = ownedRes;
  const { data: memberRows, error: memberErr } = memberRes;

  console.log("[group-access] userId:", userId, "owned:", owned?.length ?? 0, "ownedErr:", ownedErr?.message, "memberRows:", memberRows?.length ?? 0, "memberErr:", memberErr?.message);

  const ids = new Set<string>();
  for (const g of owned ?? []) ids.add(g.id);
  for (const r of memberRows ?? []) if (r.group_id) ids.add(r.group_id);

  const result = Array.from(ids);
  _idsCache.set(userId, { ids: result, ts: now });
  return result;
}
