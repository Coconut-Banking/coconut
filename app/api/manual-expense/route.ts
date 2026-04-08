export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getSupabase } from "@/lib/supabase";
import { CACHE_TAGS } from "@/lib/cached-queries";
import { getUserId } from "@/lib/auth";
import { randomUUID } from "crypto";
import {
  computeEqualShares,
  computeTwoWayShares,
  toCents,
} from "@/lib/expense-shares";
import { createRecurringExpense, processRecurringExpenses } from "@/lib/recurring-expenses";
import { formatCurrency } from "@/lib/currency";
import { notifyGroupMembers } from "@/lib/push-sender";
import { shadowCreateExpense, isShadowWriteEnabled } from "@/lib/splitwise-shadow";

let _hasPayerAndDateCols: boolean | null = null;

/**
 * POST /api/manual-expense
 * Create a manual expense and split it in a group.
 * Body: { amount, description, groupId, personKey?, payerMemberId?, shares?, category?, notes?, receipt_url? }
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
  const rawCurrency = typeof body.currency === "string" ? body.currency.trim().toUpperCase() : null;
  const currency = rawCurrency && /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : "USD";

  if (body.category != null && typeof body.category !== "string") {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }
  if (body.notes != null && typeof body.notes !== "string") {
    return NextResponse.json({ error: "Invalid notes" }, { status: 400 });
  }
  if (body.receipt_url != null && typeof body.receipt_url !== "string") {
    return NextResponse.json({ error: "Invalid receipt_url" }, { status: 400 });
  }
  const expenseCategory =
    typeof body.category === "string" ? body.category.trim().slice(0, 100) || null : null;
  const expenseNotes =
    typeof body.notes === "string" ? body.notes.trim().slice(0, 2000) || null : null;
  const receiptUrl =
    typeof body.receipt_url === "string" ? body.receipt_url.trim().slice(0, 2048) || null : null;

  const splitDetailFields: {
    notes?: string;
    category?: string;
    receipt_url?: string;
  } = {};
  if (expenseNotes) splitDetailFields.notes = expenseNotes;
  if (expenseCategory) splitDetailFields.category = expenseCategory;
  if (receiptUrl) splitDetailFields.receipt_url = receiptUrl;

  if (!groupId || !amount || amount <= 0) {
    return NextResponse.json(
      { error: "groupId and positive amount required" },
      { status: 400 }
    );
  }

  const db = getSupabase();

  // Single query: fetch all members and use current user's presence as access check
  const { data: members } = await db
    .from("group_members")
    .select("id, user_id, display_name, email")
    .eq("group_id", groupId);

  if (!members || members.length === 0) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  const currentUserMember = members.find((m) => m.user_id === userId);
  if (!currentUserMember) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
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
    const sourceGroupId =
      personKey.length > 37 && personKey[36] === "-" ? personKey.slice(0, 36) : null;
    let otherMember = members.find((m) => {
      if (m.user_id === userId) return false;
      if (memberIdFromKey && m.id === memberIdFromKey) return true;
      if (m.user_id === personKey) return true;
      if (m.email === personKey) return true;
      return false;
    });
    // When the personKey references a member in a DIFFERENT group (e.g. after
    // auto-creating a 1:1 group), look up the original member and match by
    // display_name or email. As a last resort, pick the only other member.
    if (!otherMember && memberIdFromKey && sourceGroupId && sourceGroupId !== groupId) {
      const { data: srcMembers } = await db
        .from("group_members")
        .select("display_name, email")
        .eq("id", memberIdFromKey)
        .limit(1);
      const src = srcMembers?.[0];
      if (src) {
        otherMember = members.find((m) => {
          if (m.user_id === userId) return false;
          if (src.email && m.email === src.email) return true;
          if (src.display_name && m.display_name === src.display_name) return true;
          return false;
        });
      }
    }
    if (!otherMember) {
      const others = members.filter((m) => m.user_id !== userId);
      if (others.length === 1) otherMember = others[0];
    }
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
      primary_category: expenseCategory,
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
  const expenseDate = clientDate ?? new Date().toISOString().split("T")[0];
  const insertPayload: Record<string, unknown> = {
    group_id: groupId,
    transaction_id: transaction.id,
    created_by: userId,
    iso_currency_code: currency,
    ...splitDetailFields,
  };
  if (_hasPayerAndDateCols !== false) {
    insertPayload.payer_member_id = effectivePayer;
    insertPayload.date = expenseDate;
  }
  const { data: st1, error: e1 } = await db
    .from("split_transactions")
    .insert(insertPayload)
    .select("id")
    .single();
  if (e1 && e1.message?.includes("column") && _hasPayerAndDateCols !== false) {
    _hasPayerAndDateCols = false;
    const { data: st2, error: e2 } = await db
      .from("split_transactions")
      .insert({
        group_id: groupId,
        transaction_id: transaction.id,
        created_by: userId,
        iso_currency_code: currency,
        ...splitDetailFields,
      })
      .select("id")
      .single();
    splitTx = st2;
    splitError = e2;
  } else {
    if (!e1) _hasPayerAndDateCols = true;
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

  const { data: insertedShares, error: shareErr } = await db
    .from("split_shares")
    .insert(shareRows)
    .select("id, split_transaction_id, member_id, amount");
  if (shareErr) {
    console.error("[manual-expense] split_shares insert failed:", shareErr.message, { shareRows });
    await db.from("split_transactions").delete().eq("id", splitTx.id);
    await db.from("transactions").delete().eq("id", transaction.id);
    return NextResponse.json(
      { error: shareErr.message ?? "Failed to create shares" },
      { status: 500 }
    );
  }
  console.log("[manual-expense] shares created:", {
    splitTxId: splitTx.id,
    groupId,
    insertedCount: insertedShares?.length ?? 0,
  });

  // Shadow write to Splitwise (blocking — fails the whole request on error)
  if (isShadowWriteEnabled()) {
    try {
      await shadowCreateExpense({
        clerkUserId: userId,
        groupId,
        splitTransactionId: splitTx.id,
        amount,
        description,
        currency,
        date: expenseDate,
        payerMemberId: effectivePayer,
        shares,
      });
    } catch (e) {
      console.error("[manual-expense] shadow write failed, rolling back:", e);
      await db.from("split_shares").delete().eq("split_transaction_id", splitTx.id);
      await db.from("split_transactions").delete().eq("id", splitTx.id);
      await db.from("transactions").delete().eq("id", transaction.id);
      return NextResponse.json(
        { error: `Splitwise shadow write failed: ${e instanceof Error ? e.message : String(e)}` },
        { status: 502 }
      );
    }
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
      isoCurrencyCode: currency,
    });
  }

  const creatorName =
    currentUserMember.display_name?.trim() ||
    currentUserMember.email?.split("@")[0] ||
    "Someone";
  void notifyGroupMembers(
    groupId,
    "New expense",
    `${creatorName} added ${description} for ${formatCurrency(amount, currency)}`,
    userId,
    { type: "manual_expense", groupId, splitTransactionId: splitTx.id }
  );

  void processRecurringExpenses(userId)
    .then((n) => {
      if (n > 0) {
        revalidateTag(CACHE_TAGS.splitTransactions(userId), "max");
        revalidateTag(CACHE_TAGS.transactions(userId), "max");
      }
    })
    .catch((err) => console.error("[recurring] background process failed:", err));

  return NextResponse.json({ id: splitTx.id });
}
