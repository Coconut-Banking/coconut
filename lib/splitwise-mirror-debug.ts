/**
 * Splitwise mirror debug helpers.
 *
 * Used by the debug API routes to:
 *  1. Clone a real Splitwise group into a "Mirror <Name>" group (bootstrap)
 *  2. Sync new expenses from the real group to the mirror
 *  3. Verify balance parity between real and mirror
 *
 * The mirror group IDs are stored in shadow_mirror_map (coconutGroupId → mirrorSwGroupId),
 * shared with the production shadow-write layer.
 * The last-sync timestamps are stored in debug_sync_state (coconutGroupId → ISO string),
 * which is only used by these debug routes.
 */

import { getSupabase } from "@/lib/supabase";
import { decryptToken } from "@/lib/encryption";
import {
  getGroup,
  getGroups,
  getExpenses,
  createSwExpense,
  createSwGroup,
  addUserToSwGroup,
  getCurrentUser,
  type SplitwiseGroup,
} from "@/lib/splitwise";

type DB = ReturnType<typeof getSupabase>;
type SyncState = Record<string, string>; // coconutGroupId → ISO lastSync

const MIRROR_PREFIX = "Mirror ";

// ── Token ─────────────────────────────────────────────────────────────────────

export async function getEffectiveToken(db: DB, clerkUserId: string): Promise<string> {
  const { data } = await db
    .from("splitwise_tokens")
    .select("access_token")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();
  if (!data?.access_token) {
    throw new Error("No Splitwise token — connect Splitwise in Settings first");
  }
  return decryptToken(data.access_token);
}

// ── Sync state (lastSync per coconutGroupId) ──────────────────────────────────

async function loadSyncState(db: DB, clerkUserId: string): Promise<SyncState> {
  try {
    const { data } = await db
      .from("splitwise_tokens")
      .select("debug_sync_state")
      .eq("clerk_user_id", clerkUserId)
      .maybeSingle();
    const raw = (data as Record<string, unknown> | null)?.debug_sync_state;
    if (raw && typeof raw === "object") return raw as SyncState;
  } catch {
    // Column may not exist yet
  }
  return {};
}

async function saveSyncState(db: DB, clerkUserId: string, state: SyncState): Promise<void> {
  try {
    await db
      .from("splitwise_tokens")
      .update({ debug_sync_state: state } as Record<string, unknown>)
      .eq("clerk_user_id", clerkUserId);
  } catch (e) {
    console.warn("[mirror-debug] Could not save sync state:", e);
  }
}

// ── Mirror map (shared with shadow-write layer) ───────────────────────────────

type MirrorMap = Record<string, number>; // coconutGroupId → mirrorSwGroupId

async function loadMirrorMap(db: DB, clerkUserId: string): Promise<MirrorMap> {
  try {
    const { data } = await db
      .from("splitwise_tokens")
      .select("shadow_mirror_map")
      .eq("clerk_user_id", clerkUserId)
      .maybeSingle();
    const raw = (data as Record<string, unknown> | null)?.shadow_mirror_map;
    if (raw && typeof raw === "object") return raw as MirrorMap;
  } catch {
    // Column may not exist yet
  }
  return {};
}

async function saveMirrorMap(db: DB, clerkUserId: string, map: MirrorMap): Promise<void> {
  try {
    await db
      .from("splitwise_tokens")
      .update({ shadow_mirror_map: map } as Record<string, unknown>)
      .eq("clerk_user_id", clerkUserId);
  } catch (e) {
    console.warn("[mirror-debug] Could not save mirror map:", e);
  }
}

export async function getMirrorSwGroupId(
  db: DB,
  token: string,
  coconutGroupId: string,
  coconutGroupName: string,
  clerkUserId: string
): Promise<number | null> {
  const map = await loadMirrorMap(db, clerkUserId);
  if (map[coconutGroupId]) return map[coconutGroupId];

  // Fall back to name-based lookup
  const mirrorName = `${MIRROR_PREFIX}${coconutGroupName}`;
  const allSwGroups = await getGroups(token);
  const mirror = allSwGroups.find((g) => g.name === mirrorName);
  if (mirror) {
    map[coconutGroupId] = mirror.id;
    await saveMirrorMap(db, clerkUserId, map);
    return mirror.id;
  }
  return null;
}

// ── Group resolution ──────────────────────────────────────────────────────────

export interface ResolvedGroup {
  coconutGroupId: string;
  coconutGroupName: string;
  realSwGroupId: number;
  swGroup: SplitwiseGroup;
}

export async function resolveGroupByName(
  db: DB,
  token: string,
  groupName: string
): Promise<ResolvedGroup> {
  const { data: groups } = await db
    .from("groups")
    .select("id, name, external_id, source")
    .ilike("name", groupName);

  const coconutGroup = groups?.find((g) => g.source === "splitwise" && g.external_id);

  if (!coconutGroup) {
    throw new Error(
      `No Splitwise-linked coconut group found matching "${groupName}". ` +
        `Make sure you've imported this group from Splitwise.`
    );
  }

  const realSwGroupId = Number(coconutGroup.external_id);
  const swGroup = await getGroup(token, realSwGroupId);

  return {
    coconutGroupId: coconutGroup.id,
    coconutGroupName: coconutGroup.name,
    realSwGroupId,
    swGroup,
  };
}

// ── Member mapping ────────────────────────────────────────────────────────────

export function buildRealToMirrorMemberMap(
  realMembers: SplitwiseGroup["members"],
  mirrorMembers: SplitwiseGroup["members"]
): Map<number, number> {
  const map = new Map<number, number>();
  for (const realM of realMembers) {
    const email = realM.email?.trim().toLowerCase();
    if (!email) continue;
    const mirrorM = mirrorMembers.find((m) => m.email?.trim().toLowerCase() === email);
    if (mirrorM) map.set(realM.id, mirrorM.id);
  }
  return map;
}

// ── Clone (full bootstrap) ────────────────────────────────────────────────────

export interface CloneResult {
  mirrorSwGroupId: number;
  alreadyExisted: boolean;
  copied: number;
  skipped: number;
  totalFetched: number;
}

export async function cloneMirrorGroup(
  db: DB,
  token: string,
  clerkUserId: string,
  resolved: ResolvedGroup,
  limit = 40
): Promise<CloneResult> {
  const { coconutGroupId, coconutGroupName, realSwGroupId, swGroup } = resolved;
  const map = await loadMirrorMap(db, clerkUserId);

  let mirrorSwGroupId: number | null = map[coconutGroupId] ?? null;
  let alreadyExisted = false;

  if (mirrorSwGroupId) {
    // Verify it's still accessible
    try {
      await getGroup(token, mirrorSwGroupId);
      alreadyExisted = true;
    } catch {
      console.warn(`[mirror-debug] Mirror ${mirrorSwGroupId} not accessible, will recreate`);
      mirrorSwGroupId = null;
    }
  }

  // Try name-based lookup if map had no entry
  if (!mirrorSwGroupId) {
    const mirrorName = `${MIRROR_PREFIX}${coconutGroupName}`;
    const allSwGroups = await getGroups(token);
    const existing = allSwGroups.find((g) => g.name === mirrorName);
    if (existing) {
      mirrorSwGroupId = existing.id;
      alreadyExisted = true;
    }
  }

  if (!mirrorSwGroupId) {
    // Create the mirror group
    const mirrorName = `${MIRROR_PREFIX}${coconutGroupName}`;
    console.log(`[mirror-debug] Creating mirror group "${mirrorName}"`);

    const swUser = await getCurrentUser(token);
    const { id } = await createSwGroup(token, mirrorName, swGroup.group_type ?? "other");
    mirrorSwGroupId = id;

    // Add members by SW user_id (most reliable — no email invite)
    for (const member of swGroup.members) {
      if (member.id === swUser.id) continue;
      try {
        await addUserToSwGroup(token, mirrorSwGroupId, { user_id: member.id });
      } catch (e) {
        console.warn(`[mirror-debug] Failed to add SW user ${member.id}:`, e);
      }
    }
  }

  // Persist mapping
  map[coconutGroupId] = mirrorSwGroupId;
  await saveMirrorMap(db, clerkUserId, map);

  // Fetch mirror members (after potential adds)
  const mirrorGroup = await getGroup(token, mirrorSwGroupId);
  const realToMirror = buildRealToMirrorMemberMap(swGroup.members, mirrorGroup.members);

  // Fetch the most recent `limit` expenses from the real group
  const expenses = await getExpenses(token, realSwGroupId, {
    limitPerPage: limit,
    maxPages: 1,
  });

  let copied = 0;
  let skipped = 0;

  for (const expense of expenses) {
    const users: { user_id: number; paid_share: string; owed_share: string }[] = [];
    let allMapped = true;

    for (const u of expense.users) {
      const mirrorId = realToMirror.get(u.user_id);
      if (!mirrorId) {
        allMapped = false;
        break;
      }
      users.push({ user_id: mirrorId, paid_share: u.paid_share, owed_share: u.owed_share });
    }

    if (!allMapped || users.length === 0) {
      skipped++;
      continue;
    }

    try {
      await createSwExpense(token, {
        group_id: mirrorSwGroupId,
        description: expense.description,
        cost: expense.cost,
        currency_code: expense.currency_code,
        date: expense.date,
        payment: expense.payment || undefined,
        users,
      });
      copied++;
    } catch (e) {
      console.warn(`[mirror-debug] Failed to copy expense ${expense.id}:`, e);
      skipped++;
    }
  }

  // Record lastSync
  const syncState = await loadSyncState(db, clerkUserId);
  syncState[coconutGroupId] = new Date().toISOString();
  await saveSyncState(db, clerkUserId, syncState);

  return {
    mirrorSwGroupId,
    alreadyExisted,
    copied,
    skipped,
    totalFetched: expenses.length,
  };
}

// ── Sync (incremental) ────────────────────────────────────────────────────────

export interface SyncResult {
  mirrorSwGroupId: number;
  copied: number;
  skipped: number;
  since: string | null;
}

export async function syncMirrorGroup(
  db: DB,
  token: string,
  clerkUserId: string,
  resolved: ResolvedGroup
): Promise<SyncResult> {
  const { coconutGroupId, coconutGroupName, realSwGroupId, swGroup } = resolved;

  const mirrorSwGroupId = await getMirrorSwGroupId(
    db,
    token,
    coconutGroupId,
    coconutGroupName,
    clerkUserId
  );
  if (!mirrorSwGroupId) {
    throw new Error(
      `No mirror group found for "${coconutGroupName}". Run clone first.`
    );
  }

  const syncState = await loadSyncState(db, clerkUserId);
  const lastSync = syncState[coconutGroupId] ?? null;

  // Fetch expenses from real group, optionally filtered by date
  const [mirrorGroup, newExpenses] = await Promise.all([
    getGroup(token, mirrorSwGroupId),
    getExpenses(token, realSwGroupId, {
      // dated_after filters by expense date (wall-clock approximation for sync)
      datedAfter: lastSync ? lastSync.split("T")[0] : undefined,
    }),
  ]);

  const realToMirror = buildRealToMirrorMemberMap(swGroup.members, mirrorGroup.members);

  let copied = 0;
  let skipped = 0;

  for (const expense of newExpenses) {
    const users: { user_id: number; paid_share: string; owed_share: string }[] = [];
    let allMapped = true;

    for (const u of expense.users) {
      const mirrorId = realToMirror.get(u.user_id);
      if (!mirrorId) {
        allMapped = false;
        break;
      }
      users.push({ user_id: mirrorId, paid_share: u.paid_share, owed_share: u.owed_share });
    }

    if (!allMapped || users.length === 0) {
      skipped++;
      continue;
    }

    try {
      await createSwExpense(token, {
        group_id: mirrorSwGroupId,
        description: expense.description,
        cost: expense.cost,
        currency_code: expense.currency_code,
        date: expense.date,
        payment: expense.payment || undefined,
        users,
      });
      copied++;
    } catch (e) {
      console.warn(`[mirror-debug] Failed to sync expense ${expense.id}:`, e);
      skipped++;
    }
  }

  syncState[coconutGroupId] = new Date().toISOString();
  await saveSyncState(db, clerkUserId, syncState);

  return { mirrorSwGroupId, copied, skipped, since: lastSync };
}

// ── Verify (balance parity) ───────────────────────────────────────────────────

export interface VerifyResult {
  realGroupId: number;
  mirrorGroupId: number;
  realDebts: SplitwiseGroup["simplified_debts"];
  mirrorDebts: SplitwiseGroup["simplified_debts"];
  memberMap: Record<number, number>; // realSwId → mirrorSwId
  parity: boolean;
  discrepancies: string[];
}

export async function verifyMirrorParity(
  db: DB,
  token: string,
  clerkUserId: string,
  resolved: ResolvedGroup
): Promise<VerifyResult> {
  const { coconutGroupId, coconutGroupName, realSwGroupId, swGroup: realGroup } = resolved;

  const mirrorSwGroupId = await getMirrorSwGroupId(
    db,
    token,
    coconutGroupId,
    coconutGroupName,
    clerkUserId
  );
  if (!mirrorSwGroupId) {
    throw new Error(`No mirror group found for "${coconutGroupName}". Run clone first.`);
  }

  const mirrorGroup = await getGroup(token, mirrorSwGroupId);
  const realToMirror = buildRealToMirrorMemberMap(realGroup.members, mirrorGroup.members);

  const realDebts = realGroup.simplified_debts ?? [];
  const mirrorDebts = mirrorGroup.simplified_debts ?? [];

  // Compute net position per user from simplified_debts
  const computeNet = (
    debts: SplitwiseGroup["simplified_debts"],
    memberIds: number[]
  ): Map<number, number> => {
    const net = new Map<number, number>();
    for (const id of memberIds) net.set(id, 0);
    for (const d of debts) {
      const amt = parseFloat(d.amount);
      if (!isNaN(amt)) {
        net.set(d.from, (net.get(d.from) ?? 0) - amt);
        net.set(d.to, (net.get(d.to) ?? 0) + amt);
      }
    }
    return net;
  };

  const realNet = computeNet(realDebts, realGroup.members.map((m) => m.id));
  const mirrorNet = computeNet(mirrorDebts, mirrorGroup.members.map((m) => m.id));

  const discrepancies: string[] = [];
  for (const [realId, mirrorId] of realToMirror) {
    const realAmt = realNet.get(realId) ?? 0;
    const mirrorAmt = mirrorNet.get(mirrorId) ?? 0;
    const diff = Math.abs(realAmt - mirrorAmt);
    if (diff > 0.02) {
      const m = realGroup.members.find((x) => x.id === realId);
      const name = `${m?.first_name ?? ""} ${m?.last_name ?? ""}`.trim() || String(realId);
      discrepancies.push(
        `${name}: real=${realAmt.toFixed(2)}, mirror=${mirrorAmt.toFixed(2)}, diff=${diff.toFixed(2)}`
      );
    }
  }

  return {
    realGroupId: realSwGroupId,
    mirrorGroupId: mirrorSwGroupId,
    realDebts,
    mirrorDebts,
    memberMap: Object.fromEntries(realToMirror),
    parity: discrepancies.length === 0,
    discrepancies,
  };
}
