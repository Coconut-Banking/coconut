export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { randomUUID } from "crypto";
import { getUserId } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import {
  getGroups,
  getExpenses,
  getCurrentUser,
  type SplitwiseGroup,
  type SplitwiseExpense,
} from "@/lib/splitwise";

interface ImportStats {
  groups: number;
  members: number;
  expenses: number;
  settlements: number;
  skipped: number;
}

export async function POST() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getSupabase();

  // 1. Get stored Splitwise token
  const { data: tokenRow } = await db
    .from("splitwise_tokens")
    .select("access_token")
    .eq("clerk_user_id", userId)
    .maybeSingle();

  if (!tokenRow?.access_token) {
    return NextResponse.json(
      { error: "Connect Splitwise first (Settings → Import from Splitwise)" },
      { status: 400 }
    );
  }

  const token = tokenRow.access_token;
  const stats: ImportStats = { groups: 0, members: 0, expenses: 0, settlements: 0, skipped: 0 };

  try {
    // 2. Get current Splitwise user (to know who "me" is)
    const swUser = await getCurrentUser(token);
    const clerkUser = await currentUser();
    const myEmail = clerkUser?.primaryEmailAddress?.emailAddress ?? null;

    // 3. Fetch all Splitwise groups
    const swGroups = await getGroups(token);
    console.log(`[splitwise-import] found ${swGroups.length} groups for user ${swUser.id}`);

    for (const swGroup of swGroups) {
      try {
        await importGroup(db, userId, token, swGroup, swUser.id, myEmail, stats);
      } catch (err) {
        console.error(`[splitwise-import] failed to import group "${swGroup.name}":`, err);
      }
    }

    console.log("[splitwise-import] done", stats);
    return NextResponse.json({ ok: true, stats });
  } catch (err) {
    console.error("[splitwise-import] fatal error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Import failed" },
      { status: 500 }
    );
  }
}

// ── Import one group ────────────────────────────────────────────────────────

type DB = ReturnType<typeof getSupabase>;

async function importGroup(
  db: DB,
  userId: string,
  token: string,
  swGroup: SplitwiseGroup,
  swUserId: number,
  myEmail: string | null,
  stats: ImportStats
) {
  // Map Splitwise group_type → Coconut group_type
  const typeMap: Record<string, string> = {
    apartment: "home",
    house: "home",
    trip: "trip",
    couple: "couple",
  };
  const groupType = typeMap[swGroup.group_type] ?? "other";

  // Check if already imported
  const { data: existing } = await db
    .from("groups")
    .select("id")
    .eq("source", "splitwise")
    .eq("external_id", String(swGroup.id))
    .maybeSingle();

  let groupId: string;

  if (existing) {
    groupId = existing.id;
  } else {
    const inviteToken = `inv_${randomUUID().replace(/-/g, "")}`;
    const { data: newGroup, error } = await db
      .from("groups")
      .insert({
        owner_id: userId,
        name: swGroup.name,
        group_type: groupType,
        invite_token: inviteToken,
        source: "splitwise",
        external_id: String(swGroup.id),
      })
      .select("id")
      .single();

    if (error || !newGroup) {
      console.error(`[splitwise-import] group insert error:`, error?.message);
      return;
    }
    groupId = newGroup.id;
    stats.groups++;
  }

  // 4. Import members
  const swMemberIdToCoconutId = new Map<number, string>();

  for (const swMember of swGroup.members) {
    const isMe = swMember.id === swUserId;
    const email = isMe ? (myEmail ?? swMember.email) : swMember.email;
    const displayName = `${swMember.first_name} ${swMember.last_name}`.trim() || swMember.email;

    // Check if member already exists in this group (by email)
    const { data: existingMember } = await db
      .from("group_members")
      .select("id")
      .eq("group_id", groupId)
      .eq("email", email)
      .maybeSingle();

    if (existingMember) {
      swMemberIdToCoconutId.set(swMember.id, existingMember.id);
      continue;
    }

    const { data: newMember, error } = await db
      .from("group_members")
      .insert({
        group_id: groupId,
        user_id: isMe ? userId : null,
        email,
        display_name: displayName,
      })
      .select("id")
      .single();

    if (error || !newMember) {
      console.error(`[splitwise-import] member insert error:`, error?.message);
      continue;
    }

    swMemberIdToCoconutId.set(swMember.id, newMember.id);
    stats.members++;
  }

  // 5. Fetch and import expenses
  const expenses = await getExpenses(token, swGroup.id);

  for (const expense of expenses) {
    try {
      if (expense.payment) {
        await importSettlement(db, groupId, expense, swMemberIdToCoconutId, stats);
      } else {
        await importExpense(db, groupId, userId, expense, swMemberIdToCoconutId, stats);
      }
    } catch (err) {
      console.error(`[splitwise-import] expense ${expense.id} error:`, err);
      stats.skipped++;
    }
  }
}

// ── Import one expense ──────────────────────────────────────────────────────

async function importExpense(
  db: DB,
  groupId: string,
  userId: string,
  expense: SplitwiseExpense,
  memberMap: Map<number, string>,
  stats: ImportStats
) {
  const extId = String(expense.id);

  // Check if already imported
  const { data: existing } = await db
    .from("split_transactions")
    .select("id")
    .eq("source", "splitwise")
    .eq("external_id", extId)
    .maybeSingle();

  if (existing) {
    stats.skipped++;
    return;
  }

  // Find who paid the most (the payer)
  const payer = expense.users.reduce((best, u) =>
    parseFloat(u.paid_share) > parseFloat(best.paid_share) ? u : best
  );
  const payerMemberId = memberMap.get(payer.user_id) ?? null;

  const { data: splitTx, error: txErr } = await db
    .from("split_transactions")
    .insert({
      group_id: groupId,
      transaction_id: null, // No linked bank transaction
      created_by: userId,
      payer_member_id: payerMemberId,
      source: "splitwise",
      external_id: extId,
      description: expense.description,
      amount: parseFloat(expense.cost),
      date: expense.date.split("T")[0],
    })
    .select("id")
    .single();

  if (txErr || !splitTx) {
    console.error(`[splitwise-import] split_tx insert error:`, txErr?.message);
    stats.skipped++;
    return;
  }

  // Insert shares for each member who owes something
  const shares = expense.users
    .filter((u) => parseFloat(u.owed_share) > 0)
    .map((u) => ({
      split_transaction_id: splitTx.id,
      member_id: memberMap.get(u.user_id),
      amount: parseFloat(u.owed_share),
    }))
    .filter((s) => s.member_id); // Skip members we couldn't map

  if (shares.length > 0) {
    await db.from("split_shares").insert(shares);
  }

  stats.expenses++;
}

// ── Import one settlement ───────────────────────────────────────────────────

async function importSettlement(
  db: DB,
  groupId: string,
  expense: SplitwiseExpense,
  memberMap: Map<number, string>,
  stats: ImportStats
) {
  // Splitwise payments have repayments: [{from, to, amount}]
  for (const repayment of expense.repayments) {
    const payerId = memberMap.get(repayment.from);
    const receiverId = memberMap.get(repayment.to);
    if (!payerId || !receiverId) continue;

    const amount = parseFloat(repayment.amount);
    if (amount <= 0) continue;

    // Check for duplicate by looking for same group + same members + similar amount + same date
    const expenseDate = expense.date.split("T")[0];
    const { data: existingSettlements } = await db
      .from("settlements")
      .select("id, amount, created_at")
      .eq("group_id", groupId)
      .eq("payer_member_id", payerId)
      .eq("receiver_member_id", receiverId);

    const isDuplicate = (existingSettlements ?? []).some((s) => {
      const sDate = new Date(s.created_at).toISOString().split("T")[0];
      return Math.abs(parseFloat(String(s.amount)) - amount) < 0.01 && sDate === expenseDate;
    });

    if (isDuplicate) {
      stats.skipped++;
      continue;
    }

    await db.from("settlements").insert({
      group_id: groupId,
      payer_member_id: payerId,
      receiver_member_id: receiverId,
      amount,
      method: "splitwise",
      status: "completed",
      external_reference: `splitwise:${expense.id}`,
      created_at: expense.date,
    });

    stats.settlements++;
  }
}
