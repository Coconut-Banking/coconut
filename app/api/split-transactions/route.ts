export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { revalidateTag } from "next/cache";
import { getSupabase } from "@/lib/supabase";
import { CACHE_TAGS } from "@/lib/cached-queries";
import { canAccessGroup } from "@/lib/group-access";
import { formatCurrency } from "@/lib/currency";
import { toCents } from "@/lib/expense-shares";
import { notifyGroupMembers } from "@/lib/push-sender";

export async function POST(req: NextRequest) {
  // Parallelize auth + body parse (independent)
  const [{ userId }, bodyRaw] = await Promise.all([
    auth(),
    req.json().catch(() => null),
  ]);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (bodyRaw === null) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const body = bodyRaw as Record<string, unknown>;
  const groupId = (body.groupId ?? body.group_id) as string;
  const transactionId = (body.transactionId ?? body.transaction_id) as string;
  const shares = body.shares as Array<{ memberId: string; amount: number }>;

  if (!groupId || !transactionId || !Array.isArray(shares) || shares.length === 0) {
    return NextResponse.json(
      { error: "groupId, transactionId, and shares[] required" },
      { status: 400 }
    );
  }

  const allowed = await canAccessGroup(userId, groupId);
  if (!allowed) return NextResponse.json({ error: "Group not found" }, { status: 404 });

  const db = getSupabase();

  // Fetch group members and transaction in parallel (independent reads)
  const [membersResult, txResult] = await Promise.all([
    db
      .from("group_members")
      .select("id, user_id, display_name, email")
      .eq("group_id", groupId),
    db
      .from("transactions")
      .select("id, amount, clerk_user_id, iso_currency_code, merchant_name, raw_name")
      .eq("id", transactionId)
      .eq("clerk_user_id", userId)
      .single(),
  ]);

  const groupMembers = membersResult.data;
  const memberIds = new Set((groupMembers ?? []).map((m) => m.id));
  const invalidMembers = shares.filter((s) => !memberIds.has(s.memberId));
  if (invalidMembers.length > 0) {
    return NextResponse.json(
      { error: "One or more member IDs do not belong to this group" },
      { status: 400 }
    );
  }

  const { data: tx, error: txError } = txResult;
  if (txError || !tx) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });

  const { data: existing } = await db
    .from("split_transactions")
    .select("id")
    .eq("group_id", groupId)
    .eq("transaction_id", transactionId)
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      { error: "This transaction is already in this group" },
      { status: 400 }
    );
  }

  const totalAmount = Math.abs(Number(tx.amount));
  const shareSumCents = shares.reduce((s, sh) => s + toCents(Number(sh.amount)), 0);
  const totalCents = toCents(totalAmount);
  if (Math.abs(shareSumCents - totalCents) > 1) {
    return NextResponse.json(
      { error: `Shares must sum to ${formatCurrency(totalAmount)}` },
      { status: 400 }
    );
  }

  const { data: split, error: splitErr } = await db
    .from("split_transactions")
    .insert({
      group_id: groupId,
      transaction_id: transactionId,
      created_by: userId,
      iso_currency_code: (tx.iso_currency_code ?? "USD"),
    })
    .select("id")
    .single();

  if (splitErr || !split) {
    return NextResponse.json({ error: splitErr?.message ?? "Failed to create split" }, { status: 500 });
  }
  revalidateTag(CACHE_TAGS.splitTransactions(userId), "max");

  const { data: allSplits } = await db
    .from("split_transactions")
    .select("id, created_at")
    .eq("group_id", groupId)
    .eq("transaction_id", transactionId)
    .order("created_at", { ascending: true });

  if (allSplits && allSplits.length > 1 && allSplits[0].id !== split.id) {
    await db.from("split_transactions").delete().eq("id", split.id);
    return NextResponse.json(
      { error: "This transaction is already in this group" },
      { status: 409 }
    );
  }

  const shareRows = shares
    .filter((s) => Number(s.amount) > 0)
    .map((s) => ({
      split_transaction_id: split.id,
      member_id: s.memberId,
      amount: Math.round(Number(s.amount) * 100) / 100,
    }));

  if (shareRows.length > 0) {
    const { error: sharesErr } = await db.from("split_shares").insert(shareRows);
    if (sharesErr) {
      await db.from("split_transactions").delete().eq("id", split.id);
      return NextResponse.json({ error: sharesErr.message ?? "Failed to create shares" }, { status: 500 });
    }
  }

  const creatorMember = (groupMembers ?? []).find((m) => m.user_id === userId);
  const creatorName =
    creatorMember?.display_name?.trim() ||
    creatorMember?.email?.split("@")[0] ||
    "Someone";
  const merchantLabel = (
    (tx.merchant_name || tx.raw_name || "a purchase").toString().trim() || "a purchase"
  ).slice(0, 120);
  const splitCurrency = tx.iso_currency_code ?? "USD";
  void notifyGroupMembers(
    groupId,
    "New split",
    `${creatorName} split ${merchantLabel} for ${formatCurrency(totalAmount, splitCurrency)}`,
    userId,
    { type: "split_transaction", groupId, splitTransactionId: split.id }
  );

  return NextResponse.json({ id: split.id });
}
