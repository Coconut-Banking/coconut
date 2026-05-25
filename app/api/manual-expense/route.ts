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
  const expenseDate = clientDate ?? new Date().toISOString().split("T")[0];

  // ── Fast path: client already computed shares → single RPC call ──
  const useRpc = Array.isArray(customShares) && customShares.length > 0;

  let splitTxId: string | null = null;
  let shares: { memberId: string; amount: number }[] = [];
  let effectivePayer: string | null = null;
  let currentUserMember: { id: string; display_name?: string; email?: string } | undefined;
  let members: Array<{ id: string; user_id: string; display_name: string; email: string }> | null = null;

  if (useRpc) {
    const sumCents = customShares.reduce((s, sh) => s + toCents(Number(sh.amount)), 0);
    const amountCents = toCents(amount);
    if (Math.abs(sumCents - amountCents) > 1) {
      return NextResponse.json({ error: `Shares must sum to $${amount.toFixed(2)}` }, { status: 400 });
    }
    shares = customShares
      .filter((s) => Number(s.amount) > 0)
      .map((s) => ({ memberId: s.memberId, amount: Math.round(Number(s.amount) * 100) / 100 }));

    const { data: rpcResult, error: rpcErr } = await db.rpc("create_manual_expense", {
      p_clerk_user_id: userId,
      p_group_id: groupId,
      p_amount: amount,
      p_description: description,
      p_currency: currency,
      p_date: expenseDate,
      p_category: expenseCategory,
      p_notes: expenseNotes,
      p_receipt_url: receiptUrl,
      p_payer_member_id: payerMemberId || null,
      p_shares: shares.map((s) => ({ memberId: s.memberId, amount: s.amount })),
    });

    if (rpcErr) {
      console.error("[manual-expense] RPC error:", rpcErr.message);
      return NextResponse.json({ error: rpcErr.message ?? "Failed to create expense" }, { status: 500 });
    }

    const result = rpcResult as { splitTxId?: string; txId?: string; error?: string };
    if (result.error) {
      const status = result.error === "Payer not in group" ? 400 : 404;
      return NextResponse.json({ error: result.error }, { status });
    }

    splitTxId = result.splitTxId ?? null;
    effectivePayer = payerMemberId || null;

    // We still need the current user's display_name for push notifications & shadow writes.
    // Fire this in the background — don't block the response.
    const memberPromise = db
      .from("group_members")
      .select("id, user_id, display_name, email")
      .eq("group_id", groupId);
    memberPromise.then(({ data }) => {
      members = data;
      currentUserMember = data?.find((m) => m.user_id === userId);
      if (!effectivePayer && currentUserMember) effectivePayer = currentUserMember.id;

      const creatorName =
        currentUserMember?.display_name?.trim() ||
        currentUserMember?.email?.split("@")[0] ||
        "Someone";
      void notifyGroupMembers(
        groupId,
        "New expense",
        `${creatorName} added ${description} for ${formatCurrency(amount, currency)}`,
        userId,
        { type: "manual_expense", groupId, splitTransactionId: splitTxId! }
      );

    });
  } else {
    // ── Slow path: personKey / equal-split — needs member lookup first ──
    const plaidId = `manual_${randomUUID()}`;

    const [{ data: mbrs }, { data: transaction, error: txError }] = await Promise.all([
      db.from("group_members")
        .select("id, user_id, display_name, email")
        .eq("group_id", groupId),
      db.from("transactions")
        .insert({
          clerk_user_id: userId,
          plaid_transaction_id: plaidId,
          merchant_name: description,
          raw_name: description,
          amount: -amount,
          date: expenseDate,
          is_pending: false,
          primary_category: expenseCategory,
          detailed_category: null,
        })
        .select("id")
        .single(),
    ]);
    members = mbrs;

    if (!members || members.length === 0) {
      if (transaction) await db.from("transactions").delete().eq("id", transaction.id);
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    currentUserMember = members.find((m) => m.user_id === userId);
    if (!currentUserMember) {
      if (transaction) await db.from("transactions").delete().eq("id", transaction.id);
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    if (txError || !transaction) {
      return NextResponse.json(
        { error: txError?.message ?? "Failed to create transaction" },
        { status: 500 }
      );
    }

    const memberIds = new Set(members.map((m) => m.id));

    if (payerMemberId && !memberIds.has(payerMemberId)) {
      await db.from("transactions").delete().eq("id", transaction.id);
      return NextResponse.json({ error: "Payer is not a member of this group" }, { status: 400 });
    }

    if (personKey) {
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
        await db.from("transactions").delete().eq("id", transaction.id);
        return NextResponse.json({ error: "Person not found in group" }, { status: 404 });
      }
      shares = computeTwoWayShares(amount, currentUserMember.id, otherMember.id);
    } else {
      shares = computeEqualShares(
        amount,
        members.map((m) => m.id)
      );
    }

    effectivePayer = payerMemberId
      ? members.find((m) => m.id === payerMemberId)?.id ?? currentUserMember.id
      : currentUserMember.id;

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
    let splitTx: { id: string } | null = st1;
    let splitError: { message?: string } | null = e1;
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

    const { error: shareErr } = await db
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

    splitTxId = splitTx.id;

    const creatorName =
      currentUserMember.display_name?.trim() ||
      currentUserMember.email?.split("@")[0] ||
      "Someone";
    void notifyGroupMembers(
      groupId,
      "New expense",
      `${creatorName} added ${description} for ${formatCurrency(amount, currency)}`,
      userId,
      { type: "manual_expense", groupId, splitTransactionId: splitTxId }
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
      isoCurrencyCode: currency,
    });
  }

  void processRecurringExpenses(userId)
    .then((n) => {
      if (n > 0) {
        revalidateTag(CACHE_TAGS.splitTransactions(userId), "max");
        revalidateTag(CACHE_TAGS.transactions(userId), "max");
      }
    })
    .catch((err) => console.error("[recurring] background process failed:", err));

  return NextResponse.json({ id: splitTxId });
}
