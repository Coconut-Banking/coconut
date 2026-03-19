export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getSupabase } from "@/lib/supabase";
import { CACHE_TAGS } from "@/lib/cached-queries";
import { canAccessGroup } from "@/lib/group-access";
import { getUserId } from "@/lib/auth";
import { randomUUID } from "crypto";
import {
  computeEqualShares,
  computeTwoWayShares,
  toCents,
} from "@/lib/expense-shares";
import { createRecurringExpense } from "@/lib/recurring-expenses";

/**
 * POST /api/manual-expense
 * Create a manual expense and split it in a group.
 * Body: { amount, description, groupId, personKey?, payerMemberId?, shares? }
 * - personKey: split 50/50 with that person
 * - shares: custom amounts [{ memberId, amount }] — must sum to amount
 * - payerMemberId: who paid (default: current user)
 */
export async function POST(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const groupId = body.groupId ?? body.group_id;
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Valid positive amount required" }, { status: 400 });
  }
  const description = ((body.description ?? "Expense").toString().trim() || "Expense").slice(0, 500);
  const personKey = body.personKey ?? body.person_key;
  const payerMemberId = body.payerMemberId ?? body.payer_member_id ?? null;
  const customShares = body.shares as Array<{ memberId: string; amount: number }> | undefined;
  const clientDate = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
    ? body.date
    : null;

  if (!groupId || !amount || amount <= 0) {
    return NextResponse.json(
      { error: "groupId and positive amount required" },
      { status: 400 }
    );
  }

  const allowed = await canAccessGroup(userId, groupId);
  if (!allowed) return NextResponse.json({ error: "Group not found" }, { status: 404 });

  const db = getSupabase();

  const { data: members } = await db
    .from("group_members")
    .select("id, user_id, display_name, email")
    .eq("group_id", groupId);

  if (!members || members.length === 0) {
    return NextResponse.json({ error: "Group has no members" }, { status: 400 });
  }

  const currentUserMember = members.find((m) => m.user_id === userId);
  if (!currentUserMember) {
    return NextResponse.json({ error: "You are not a member of this group" }, { status: 400 });
  }

  const memberIds = new Set(members.map((m) => m.id));

  if (payerMemberId && !memberIds.has(payerMemberId)) {
    return NextResponse.json({ error: "Payer is not a member of this group" }, { status: 400 });
  }

  if (Array.isArray(customShares) && customShares.length > 0) {
    const invalidMembers = customShares.filter((s) => !memberIds.has(s.memberId));
    if (invalidMembers.length > 0) {
      return NextResponse.json(
        { error: "One or more member IDs do not belong to this group" },
        { status: 400 }
      );
    }
  }

  let shares: { memberId: string; amount: number }[];
  if (Array.isArray(customShares) && customShares.length > 0) {
    const sumCents = customShares.reduce((s, sh) => s + toCents(Number(sh.amount)), 0);
    const amountCents = toCents(amount);
    if (Math.abs(sumCents - amountCents) > 1) {
      return NextResponse.json({ error: `Shares must sum to $${amount.toFixed(2)}` }, { status: 400 });
    }
    shares = customShares
      .filter((s) => Number(s.amount) > 0)
      .map((s) => ({ memberId: s.memberId, amount: Math.round(Number(s.amount) * 100) / 100 }));
  } else if (personKey) {
    const memberIdFromKey =
      personKey.length > 37 && personKey[36] === "-" ? personKey.slice(37) : null;
    const otherMember = members.find((m) => {
      if (m.user_id === userId) return false;
      if (memberIdFromKey && m.id === memberIdFromKey) return true;
      if (m.user_id === personKey) return true;
      if (m.email === personKey) return true;
      return false;
    });
    if (!otherMember) {
      return NextResponse.json({ error: "Person not found in group" }, { status: 404 });
    }
    shares = computeTwoWayShares(amount, currentUserMember.id, otherMember.id);
  } else {
    shares = computeEqualShares(
      amount,
      members.map((m) => m.id)
    );
  }

  const effectivePayer = payerMemberId
    ? members.find((m) => m.id === payerMemberId)?.id ?? currentUserMember.id
    : currentUserMember.id;

  const plaidId = `manual_${randomUUID()}`;

  const { data: transaction, error: txError } = await db
    .from("transactions")
    .insert({
      clerk_user_id: userId,
      plaid_transaction_id: plaidId,
      merchant_name: description,
      raw_name: description,
      amount: -amount,
      date: clientDate ?? new Date().toISOString().split("T")[0],
      is_pending: false,
      primary_category: "Food & Drink",
      detailed_category: null,
    })
    .select("id")
    .single();

  if (txError || !transaction) {
    return NextResponse.json(
      { error: txError?.message ?? "Failed to create transaction" },
      { status: 500 }
    );
  }

  let splitTx: { id: string } | null = null;
  let splitError: { message?: string } | null = null;
  const { data: st1, error: e1 } = await db
    .from("split_transactions")
    .insert({
      group_id: groupId,
      transaction_id: transaction.id,
      created_by: userId,
      payer_member_id: effectivePayer,
    })
    .select("id")
    .single();
  if (e1 && e1.message?.includes("column")) {
    const { data: st2, error: e2 } = await db
      .from("split_transactions")
      .insert({
        group_id: groupId,
        transaction_id: transaction.id,
        created_by: userId,
      })
      .select("id")
      .single();
    splitTx = st2;
    splitError = e2;
  } else {
    splitTx = st1;
    splitError = e1;
  }

  if (splitError || !splitTx) {
    await db.from("transactions").delete().eq("id", transaction.id);
    return NextResponse.json(
      { error: splitError?.message ?? "Failed to create split" },
      { status: 500 }
    );
  }

  const shareRows = shares.map((s) => ({
    split_transaction_id: splitTx.id,
    member_id: s.memberId,
    amount: s.amount,
  }));

  const { error: shareErr } = await db.from("split_shares").insert(shareRows);
  if (shareErr) {
    await db.from("split_transactions").delete().eq("id", splitTx.id);
    await db.from("transactions").delete().eq("id", transaction.id);
    return NextResponse.json(
      { error: shareErr.message ?? "Failed to create shares" },
      { status: 500 }
    );
  }

  revalidateTag(CACHE_TAGS.splitTransactions(userId), "max");
  revalidateTag(CACHE_TAGS.transactions(userId), "max");

  const recurringFrequency = body.recurringFrequency ?? body.recurring_frequency;
  if (recurringFrequency && ["weekly", "biweekly", "monthly"].includes(recurringFrequency)) {
    await createRecurringExpense({
      clerkUserId: userId,
      groupId,
      personKey,
      amount,
      description,
      frequency: recurringFrequency,
    });
  }

  return NextResponse.json({ id: splitTx.id });
}
