/**
 * Splitwise Shadow Write — dual-write verification layer using MIRROR groups.
 *
 * When SPLITWISE_SHADOW_WRITE=1, every expense/settlement mutation in Coconut
 * is mirrored to a separate "Mirror [GroupName]" group in Splitwise. The user's
 * real Splitwise groups are NEVER touched.
 *
 * On first write for a group, the mirror is bootstrapped by copying all
 * historical expenses from the real Splitwise group.
 *
 * Blocking mode: if the Splitwise write fails, the whole operation fails.
 */

import { getSupabase } from "@/lib/supabase";
import { decryptToken } from "@/lib/encryption";
import {
  getGroup,
  getGroups,
  getExpenses,
  createSwExpense,
  updateSwExpense,
  deleteSwExpense,
  createSwGroup,
  addUserToSwGroup,
  getCurrentUser,
  type SwExpenseUserShare,
  type SplitwiseExpense,
} from "@/lib/splitwise";

type DB = ReturnType<typeof getSupabase>;

const MIRROR_PREFIX = "Mirror ";

export function isShadowWriteEnabled(): boolean {
  return process.env.SPLITWISE_SHADOW_WRITE === "1";
}

// ── Token resolution ─────────────────────────────────────────────────────────

async function getSwToken(db: DB, clerkUserId: string): Promise<string> {
  const { data } = await db
    .from("splitwise_tokens")
    .select("access_token")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  if (!data?.access_token) {
    throw new Error("[shadow] No Splitwise token — connect Splitwise in Settings first");
  }
  return decryptToken(data.access_token);
}

// ── Mirror group ID persistence ──────────────────────────────────────────────
// Stores the mirror mapping as JSONB on splitwise_tokens.shadow_mirror_map.
// Falls back to name-based lookup if the column doesn't exist.

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
    // Column may not exist — that's fine
  }
  return {};
}

async function saveMirrorMap(db: DB, clerkUserId: string, map: MirrorMap): Promise<void> {
  try {
    await db
      .from("splitwise_tokens")
      .update({ shadow_mirror_map: map } as Record<string, unknown>)
      .eq("clerk_user_id", clerkUserId);
  } catch {
    // Column may not exist — fall back silently; we'll re-discover by name next time
    console.warn("[shadow] Could not persist mirror map — column may not exist. Will use name-based lookup.");
  }
}

// ── Member mapping ───────────────────────────────────────────────────────────

interface MirrorContext {
  mirrorSwGroupId: number;
  coconutToSw: Map<string, number>;
}

function matchMembers(
  coconutMembers: { id: string; email?: string | null; display_name?: string | null }[],
  swMembers: { id: number; email?: string | null; first_name?: string; last_name?: string }[]
): Map<string, number> {
  const coconutToSw = new Map<string, number>();
  const usedSwIds = new Set<number>();

  // Pass 1: match by email (most reliable)
  for (const member of coconutMembers) {
    const email = member.email?.trim().toLowerCase();
    if (!email) continue;
    const swMember = swMembers.find((m) => !usedSwIds.has(m.id) && m.email?.trim().toLowerCase() === email);
    if (swMember) {
      coconutToSw.set(member.id, swMember.id);
      usedSwIds.add(swMember.id);
    }
  }

  // Pass 2: match by display_name ↔ first_name + last_name
  for (const member of coconutMembers) {
    if (coconutToSw.has(member.id)) continue;
    const name = member.display_name?.trim().toLowerCase();
    if (!name) continue;
    const swMember = swMembers.find((m) => {
      if (usedSwIds.has(m.id)) return false;
      const fullName = `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim().toLowerCase();
      return fullName === name || m.first_name?.trim().toLowerCase() === name;
    });
    if (swMember) {
      coconutToSw.set(member.id, swMember.id);
      usedSwIds.add(swMember.id);
    }
  }

  return coconutToSw;
}

// ── Ensure mirror group exists + bootstrap ───────────────────────────────────

async function ensureMirrorGroup(
  db: DB,
  token: string,
  coconutGroupId: string,
  clerkUserId: string
): Promise<MirrorContext> {
  const { data: group } = await db
    .from("groups")
    .select("id, name, group_type, external_id, source")
    .eq("id", coconutGroupId)
    .single();

  if (!group) throw new Error(`[shadow] Group ${coconutGroupId} not found`);

  const mirrorMap = await loadMirrorMap(db, clerkUserId);

  // Check if we already have a mirror for this group
  if (mirrorMap[coconutGroupId]) {
    const mirrorSwGroupId = mirrorMap[coconutGroupId];
    try {
      const [mirrorGroup, { data: members }] = await Promise.all([
        getGroup(token, mirrorSwGroupId),
        db.from("group_members").select("id, email, display_name").eq("group_id", coconutGroupId),
      ]);
      console.log(`[shadow] Found mirror ${mirrorSwGroupId} via map, coconut members:`,
        (members ?? []).map((m) => ({ id: m.id, email: m.email, name: m.display_name })),
        "sw members:", mirrorGroup.members.map((m) => ({ id: m.id, email: m.email, name: `${m.first_name} ${m.last_name}` }))
      );
      const coconutToSw = matchMembers(members ?? [], mirrorGroup.members);
      console.log(`[shadow] matchMembers result: ${coconutToSw.size} mappings`, Object.fromEntries(coconutToSw));
      if (coconutToSw.size > 0) {
        return { mirrorSwGroupId, coconutToSw };
      }
    } catch (e) {
      console.warn(`[shadow] Mirror group ${mirrorSwGroupId} not accessible, will recreate:`, e);
    }
  }

  // Also try to find by name (in case mirror map was lost)
  const mirrorName = `${MIRROR_PREFIX}${group.name}`;
  const allSwGroups = await getGroups(token);
  const existingMirror = allSwGroups.find((g) => g.name === mirrorName);

  if (existingMirror) {
    mirrorMap[coconutGroupId] = existingMirror.id;
    await saveMirrorMap(db, clerkUserId, mirrorMap);

    const { data: members } = await db
      .from("group_members")
      .select("id, email, display_name")
      .eq("group_id", coconutGroupId);
    const coconutToSw = matchMembers(members ?? [], existingMirror.members);
    if (coconutToSw.size > 0) {
      return { mirrorSwGroupId: existingMirror.id, coconutToSw };
    }
  }

  // Create a new mirror group
  console.log(`[shadow] Creating mirror group "${mirrorName}"`);
  const typeMap: Record<string, string> = {
    home: "apartment",
    trip: "trip",
    couple: "couple",
    friend: "other",
    other: "other",
  };
  const swType = typeMap[group.group_type ?? "other"] ?? "other";
  const { id: mirrorSwGroupId } = await createSwGroup(token, mirrorName, swType);

  const { data: members } = await db
    .from("group_members")
    .select("id, email, display_name, user_id")
    .eq("group_id", coconutGroupId);

  const swUser = await getCurrentUser(token);

  // For SW-linked groups, add members from the real Splitwise group by user_id
  // so we don't depend on Coconut group_members having emails.
  if (group.external_id && group.source === "splitwise") {
    const realSwGroupId = Number(group.external_id);
    const realGroup = await getGroup(token, realSwGroupId);
    for (const rm of realGroup.members) {
      if (rm.id === swUser.id) continue;
      try {
        await addUserToSwGroup(token, mirrorSwGroupId, { user_id: rm.id });
      } catch (e) {
        console.warn(`[shadow] Failed to add SW user ${rm.id} to mirror:`, e);
      }
    }
  } else {
    for (const member of members ?? []) {
      if (member.user_id === clerkUserId) continue;
      const email = member.email?.trim();
      if (email) {
        const nameParts = (member.display_name ?? "").split(" ");
        try {
          await addUserToSwGroup(token, mirrorSwGroupId, {
            email,
            first_name: nameParts[0] || email.split("@")[0],
            last_name: nameParts.slice(1).join(" ") || undefined,
          });
        } catch (e) {
          console.warn(`[shadow] Failed to add ${email} to mirror group:`, e);
        }
      }
    }
  }

  // Re-fetch mirror to get all member IDs
  const freshMirror = await getGroup(token, mirrorSwGroupId);
  const coconutToSw = matchMembers(members ?? [], freshMirror.members);

  // Persist the mapping
  mirrorMap[coconutGroupId] = mirrorSwGroupId;
  await saveMirrorMap(db, clerkUserId, mirrorMap);

  // Bootstrap: copy historical expenses from real Splitwise group into mirror
  if (group.external_id && group.source === "splitwise") {
    const realSwGroupId = Number(group.external_id);
    await bootstrapMirrorFromReal(token, realSwGroupId, mirrorSwGroupId, freshMirror, swUser.id);
  }

  console.log(`[shadow] Mirror group ${mirrorSwGroupId} ready for "${group.name}"`);
  return { mirrorSwGroupId, coconutToSw };
}

// ── Bootstrap mirror with historical data ────────────────────────────────────

async function bootstrapMirrorFromReal(
  token: string,
  realSwGroupId: number,
  mirrorSwGroupId: number,
  mirrorGroup: Awaited<ReturnType<typeof getGroup>>,
  mySwUserId: number
): Promise<void> {
  console.log(`[shadow] Bootstrapping mirror ${mirrorSwGroupId} from real group ${realSwGroupId}`);

  const realGroup = await getGroup(token, realSwGroupId);
  const expenses = await getExpenses(token, realSwGroupId);

  // Build real SW user ID → mirror SW user ID mapping (by email)
  const realToMirror = new Map<number, number>();
  for (const realMember of realGroup.members) {
    const email = realMember.email?.trim().toLowerCase();
    if (!email) continue;
    const mirrorMember = mirrorGroup.members.find(
      (m) => m.email?.trim().toLowerCase() === email
    );
    if (mirrorMember) realToMirror.set(realMember.id, mirrorMember.id);
  }

  let copied = 0;
  let skipped = 0;

  for (const expense of expenses) {
    try {
      const isPayment = expense.payment;
      const users: SwExpenseUserShare[] = [];
      let allMapped = true;

      for (const u of expense.users) {
        const mirrorId = realToMirror.get(u.user_id);
        if (!mirrorId) { allMapped = false; break; }
        users.push({
          user_id: mirrorId,
          paid_share: u.paid_share,
          owed_share: u.owed_share,
        });
      }

      if (!allMapped || users.length === 0) {
        skipped++;
        continue;
      }

      await createSwExpense(token, {
        group_id: mirrorSwGroupId,
        description: expense.description,
        cost: expense.cost,
        currency_code: expense.currency_code,
        date: expense.date,
        payment: isPayment || undefined,
        users,
      });
      copied++;
    } catch (e) {
      console.warn(`[shadow] Failed to copy expense ${expense.id}:`, e);
      skipped++;
    }
  }

  console.log(`[shadow] Bootstrap complete: ${copied} copied, ${skipped} skipped`);
}

// ── Shadow: Create Expense ───────────────────────────────────────────────────

export interface ShadowExpenseParams {
  clerkUserId: string;
  groupId: string;
  splitTransactionId: string;
  amount: number;
  description: string;
  currency: string;
  date?: string;
  payerMemberId: string;
  shares: Array<{ memberId: string; amount: number }>;
}

export async function shadowCreateExpense(params: ShadowExpenseParams): Promise<void> {
  console.log("[shadow] shadowCreateExpense called, enabled:", isShadowWriteEnabled());
  if (!isShadowWriteEnabled()) return;

  const db = getSupabase();
  const token = await getSwToken(db, params.clerkUserId);
  const { mirrorSwGroupId, coconutToSw } = await ensureMirrorGroup(
    db,
    token,
    params.groupId,
    params.clerkUserId
  );

  const payerSwId = coconutToSw.get(params.payerMemberId);
  if (!payerSwId) {
    throw new Error(`[shadow] Payer ${params.payerMemberId} has no mirror mapping`);
  }

  const users: SwExpenseUserShare[] = [];
  for (const share of params.shares) {
    const swId = coconutToSw.get(share.memberId);
    if (!swId) {
      throw new Error(`[shadow] Member ${share.memberId} has no mirror mapping`);
    }
    users.push({
      user_id: swId,
      paid_share: swId === payerSwId ? params.amount.toFixed(2) : "0.00",
      owed_share: share.amount.toFixed(2),
    });
  }

  if (!users.find((u) => u.user_id === payerSwId)) {
    users.push({
      user_id: payerSwId,
      paid_share: params.amount.toFixed(2),
      owed_share: "0.00",
    });
  }

  const { id: swExpenseId } = await createSwExpense(token, {
    group_id: mirrorSwGroupId,
    description: params.description,
    cost: params.amount.toFixed(2),
    currency_code: params.currency,
    date: params.date ? `${params.date}T12:00:00Z` : undefined,
    users,
  });

  // Store the MIRROR expense ID on the split_transaction for future updates/deletes
  await db
    .from("split_transactions")
    .update({ external_id: String(swExpenseId), source: "splitwise_mirror" } as Record<string, unknown>)
    .eq("id", params.splitTransactionId);

  console.log(
    `[shadow] Created mirror expense ${swExpenseId} for split_tx ${params.splitTransactionId}`
  );
}

// ── Shadow: Update Expense ───────────────────────────────────────────────────

export interface ShadowUpdateParams {
  clerkUserId: string;
  splitTransactionId: string;
  groupId: string;
  description?: string;
  amount?: number;
  payerMemberId?: string;
  shares?: Array<{ memberId: string; amount: number }>;
}

export async function shadowUpdateExpense(params: ShadowUpdateParams): Promise<void> {
  if (!isShadowWriteEnabled()) return;

  const db = getSupabase();

  const { data: splitTx } = await db
    .from("split_transactions")
    .select("external_id, group_id, source")
    .eq("id", params.splitTransactionId)
    .single();

  // Only update expenses we created in the mirror
  if (!splitTx?.external_id || splitTx.source !== "splitwise_mirror") {
    console.warn(`[shadow] split_tx ${params.splitTransactionId} not a mirror expense — skipping update`);
    return;
  }

  const swExpenseId = Number(splitTx.external_id);
  const token = await getSwToken(db, params.clerkUserId);
  const { coconutToSw } = await ensureMirrorGroup(db, token, params.groupId, params.clerkUserId);

  const update: Parameters<typeof updateSwExpense>[2] = {};
  if (params.description) update.description = params.description;
  if (params.amount) update.cost = params.amount.toFixed(2);

  if (params.shares && params.payerMemberId) {
    const payerSwId = coconutToSw.get(params.payerMemberId);
    if (!payerSwId) throw new Error(`[shadow] Payer ${params.payerMemberId} unmapped`);

    const totalAmount = params.amount ?? params.shares.reduce((s, sh) => s + sh.amount, 0);
    const users: SwExpenseUserShare[] = [];

    for (const share of params.shares) {
      const swId = coconutToSw.get(share.memberId);
      if (!swId) throw new Error(`[shadow] Member ${share.memberId} unmapped`);
      users.push({
        user_id: swId,
        paid_share: swId === payerSwId ? totalAmount.toFixed(2) : "0.00",
        owed_share: share.amount.toFixed(2),
      });
    }
    if (!users.find((u) => u.user_id === payerSwId)) {
      users.push({ user_id: payerSwId, paid_share: totalAmount.toFixed(2), owed_share: "0.00" });
    }
    update.users = users;
  }

  await updateSwExpense(token, swExpenseId, update);
  console.log(`[shadow] Updated mirror expense ${swExpenseId}`);
}

// ── Shadow: Delete Expense ───────────────────────────────────────────────────

export async function shadowDeleteExpense(
  clerkUserId: string,
  splitTransactionId: string
): Promise<void> {
  if (!isShadowWriteEnabled()) return;

  const db = getSupabase();

  const { data: splitTx } = await db
    .from("split_transactions")
    .select("external_id, source")
    .eq("id", splitTransactionId)
    .single();

  if (!splitTx?.external_id || splitTx.source !== "splitwise_mirror") {
    console.warn(`[shadow] split_tx ${splitTransactionId} not a mirror expense — skipping delete`);
    return;
  }

  const token = await getSwToken(db, clerkUserId);
  await deleteSwExpense(token, Number(splitTx.external_id));
  console.log(`[shadow] Deleted mirror expense ${splitTx.external_id}`);
}

// ── Shadow: Settlement ───────────────────────────────────────────────────────

export interface ShadowSettlementParams {
  clerkUserId: string;
  groupId: string;
  payerMemberId: string;
  receiverMemberId: string;
  amount: number;
  currency: string;
}

export async function shadowRecordSettlement(params: ShadowSettlementParams): Promise<void> {
  if (!isShadowWriteEnabled()) return;

  const db = getSupabase();
  const token = await getSwToken(db, params.clerkUserId);
  const { mirrorSwGroupId, coconutToSw } = await ensureMirrorGroup(
    db,
    token,
    params.groupId,
    params.clerkUserId
  );

  const payerSwId = coconutToSw.get(params.payerMemberId);
  const receiverSwId = coconutToSw.get(params.receiverMemberId);
  if (!payerSwId) throw new Error(`[shadow] Payer ${params.payerMemberId} unmapped`);
  if (!receiverSwId) throw new Error(`[shadow] Receiver ${params.receiverMemberId} unmapped`);

  await createSwExpense(token, {
    group_id: mirrorSwGroupId,
    description: "Payment",
    cost: params.amount.toFixed(2),
    currency_code: params.currency,
    payment: true,
    users: [
      { user_id: payerSwId, paid_share: params.amount.toFixed(2), owed_share: "0.00" },
      { user_id: receiverSwId, paid_share: "0.00", owed_share: params.amount.toFixed(2) },
    ],
  });

  console.log(
    `[shadow] Recorded settlement in mirror ${mirrorSwGroupId}: ${payerSwId} → ${receiverSwId} ${params.amount}`
  );
}

// ── Exported: get mirror group ID for verify endpoint ────────────────────────

export async function getMirrorGroupId(
  db: DB,
  token: string,
  coconutGroupId: string,
  clerkUserId: string
): Promise<number | null> {
  const mirrorMap = await loadMirrorMap(db, clerkUserId);
  if (mirrorMap[coconutGroupId]) return mirrorMap[coconutGroupId];

  // Fall back to name-based lookup
  const { data: group } = await db
    .from("groups")
    .select("name")
    .eq("id", coconutGroupId)
    .single();
  if (!group) return null;

  const mirrorName = `${MIRROR_PREFIX}${group.name}`;
  const allSwGroups = await getGroups(token);
  const mirror = allSwGroups.find((g) => g.name === mirrorName);
  return mirror?.id ?? null;
}
