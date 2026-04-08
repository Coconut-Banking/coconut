/**
 * Splitwise Shadow Write — dual-write verification layer.
 *
 * When SPLITWISE_SHADOW_WRITE=1, every expense/settlement mutation in Coconut
 * is mirrored to Splitwise. This lets devs compare Coconut balances against
 * Splitwise as a reference oracle to catch regressions.
 *
 * Blocking mode: if the Splitwise write fails, the whole operation fails.
 */

import { getSupabase } from "@/lib/supabase";
import { decryptToken } from "@/lib/encryption";
import {
  getGroup,
  createSwExpense,
  updateSwExpense,
  deleteSwExpense,
  createSwGroup,
  addUserToSwGroup,
  getCurrentUser,
  type SplitwiseGroup,
  type SwExpenseUserShare,
} from "@/lib/splitwise";

type DB = ReturnType<typeof getSupabase>;

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

// ── Member mapping ───────────────────────────────────────────────────────────
// Resolves Coconut member IDs → Splitwise user IDs by matching emails against
// the Splitwise group's member list.

interface MemberMap {
  swGroupId: number;
  coconutToSw: Map<string, number>;
}

async function resolveMemberMap(
  db: DB,
  token: string,
  coconutGroupId: string
): Promise<MemberMap> {
  const { data: group } = await db
    .from("groups")
    .select("external_id, source")
    .eq("id", coconutGroupId)
    .single();

  if (!group?.external_id) {
    throw new Error(`[shadow] Group ${coconutGroupId} has no Splitwise mapping`);
  }

  const swGroupId = Number(group.external_id);
  const [swGroup, { data: members }] = await Promise.all([
    getGroup(token, swGroupId),
    db.from("group_members").select("id, email, display_name").eq("group_id", coconutGroupId),
  ]);

  const coconutToSw = new Map<string, number>();
  for (const member of members ?? []) {
    const email = member.email?.trim().toLowerCase();
    if (!email) continue;
    const swMember = swGroup.members.find(
      (m) => m.email?.trim().toLowerCase() === email
    );
    if (swMember) {
      coconutToSw.set(member.id, swMember.id);
    }
  }

  if (coconutToSw.size === 0) {
    throw new Error(
      `[shadow] No members matched between Coconut group ${coconutGroupId} and Splitwise group ${swGroupId}`
    );
  }

  return { swGroupId, coconutToSw };
}

// ── Ensure Splitwise group exists ────────────────────────────────────────────
// For groups created natively in Coconut, auto-create a Splitwise counterpart.

async function ensureSwGroup(
  db: DB,
  token: string,
  coconutGroupId: string,
  clerkUserId: string
): Promise<MemberMap> {
  const { data: group } = await db
    .from("groups")
    .select("id, name, group_type, external_id, source")
    .eq("id", coconutGroupId)
    .single();

  if (!group) throw new Error(`[shadow] Group ${coconutGroupId} not found`);

  if (group.external_id && group.source === "splitwise") {
    return resolveMemberMap(db, token, coconutGroupId);
  }

  // Create a new Splitwise group
  console.log(`[shadow] Auto-creating Splitwise group for "${group.name}"`);
  const typeMap: Record<string, string> = {
    home: "apartment",
    trip: "trip",
    couple: "couple",
    friend: "other",
    other: "other",
  };
  const swType = typeMap[group.group_type ?? "other"] ?? "other";
  const { id: swGroupId } = await createSwGroup(token, group.name, swType);

  // Tag the Coconut group with the new Splitwise ID
  await db
    .from("groups")
    .update({ external_id: String(swGroupId), source: "splitwise" })
    .eq("id", coconutGroupId);

  // Add members to the Splitwise group
  const { data: members } = await db
    .from("group_members")
    .select("id, email, display_name, user_id")
    .eq("group_id", coconutGroupId);

  const swUser = await getCurrentUser(token);
  const coconutToSw = new Map<string, number>();

  for (const member of members ?? []) {
    if (member.user_id === clerkUserId) {
      coconutToSw.set(member.id, swUser.id);
      continue;
    }
    const email = member.email?.trim();
    if (email) {
      const nameParts = (member.display_name ?? "").split(" ");
      try {
        await addUserToSwGroup(token, swGroupId, {
          email,
          first_name: nameParts[0] || email.split("@")[0],
          last_name: nameParts.slice(1).join(" ") || undefined,
        });
      } catch (e) {
        console.warn(`[shadow] Failed to add ${email} to Splitwise group:`, e);
      }
    }
  }

  // Re-fetch the Splitwise group to get assigned user IDs for all members
  const freshSwGroup = await getGroup(token, swGroupId);
  for (const member of members ?? []) {
    const email = member.email?.trim().toLowerCase();
    if (!email) continue;
    const swMember = freshSwGroup.members.find(
      (m) => m.email?.trim().toLowerCase() === email
    );
    if (swMember) coconutToSw.set(member.id, swMember.id);
  }

  return { swGroupId, coconutToSw };
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
  if (!isShadowWriteEnabled()) return;

  const db = getSupabase();
  const token = await getSwToken(db, params.clerkUserId);
  const { swGroupId, coconutToSw } = await ensureSwGroup(
    db,
    token,
    params.groupId,
    params.clerkUserId
  );

  const payerSwId = coconutToSw.get(params.payerMemberId);
  if (!payerSwId) {
    throw new Error(`[shadow] Payer ${params.payerMemberId} has no Splitwise mapping`);
  }

  const users: SwExpenseUserShare[] = [];
  for (const share of params.shares) {
    const swId = coconutToSw.get(share.memberId);
    if (!swId) {
      throw new Error(`[shadow] Member ${share.memberId} has no Splitwise mapping`);
    }
    users.push({
      user_id: swId,
      paid_share: swId === payerSwId ? params.amount.toFixed(2) : "0.00",
      owed_share: share.amount.toFixed(2),
    });
  }

  // If the payer isn't in the shares list, add them with owed_share = 0
  if (!users.find((u) => u.user_id === payerSwId)) {
    users.push({
      user_id: payerSwId,
      paid_share: params.amount.toFixed(2),
      owed_share: "0.00",
    });
  }

  const { id: swExpenseId } = await createSwExpense(token, {
    group_id: swGroupId,
    description: params.description,
    cost: params.amount.toFixed(2),
    currency_code: params.currency,
    date: params.date ? `${params.date}T12:00:00Z` : undefined,
    users,
  });

  // Store the Splitwise expense ID on the split_transaction for future updates/deletes
  await db
    .from("split_transactions")
    .update({ external_id: String(swExpenseId), source: "splitwise" } as Record<string, unknown>)
    .eq("id", params.splitTransactionId);

  console.log(
    `[shadow] Created SW expense ${swExpenseId} for split_tx ${params.splitTransactionId}`
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

  // Get the Splitwise expense ID stored on the split_transaction
  const { data: splitTx } = await db
    .from("split_transactions")
    .select("external_id, group_id")
    .eq("id", params.splitTransactionId)
    .single();

  if (!splitTx?.external_id) {
    console.warn(`[shadow] No SW expense ID for split_tx ${params.splitTransactionId} — skipping update`);
    return;
  }

  const swExpenseId = Number(splitTx.external_id);
  const token = await getSwToken(db, params.clerkUserId);
  const { coconutToSw } = await resolveMemberMap(db, token, params.groupId);

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
  console.log(`[shadow] Updated SW expense ${swExpenseId}`);
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
    .select("external_id")
    .eq("id", splitTransactionId)
    .single();

  if (!splitTx?.external_id) {
    console.warn(`[shadow] No SW expense ID for split_tx ${splitTransactionId} — skipping delete`);
    return;
  }

  const token = await getSwToken(db, clerkUserId);
  await deleteSwExpense(token, Number(splitTx.external_id));
  console.log(`[shadow] Deleted SW expense ${splitTx.external_id}`);
}

// ── Shadow: Settlement (as Splitwise payment expense) ────────────────────────

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
  const { swGroupId, coconutToSw } = await ensureSwGroup(
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
    group_id: swGroupId,
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
    `[shadow] Recorded settlement in SW group ${swGroupId}: ${payerSwId} → ${receiverSwId} ${params.amount}`
  );
}
