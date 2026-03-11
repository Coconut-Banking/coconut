import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { canAccessGroup } from "@/lib/group-access";
import { formatCurrency } from "@/lib/currency";
import { toCents } from "@/lib/expense-shares";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const groupId = body.groupId ?? body.group_id;
  const transactionId = body.transactionId ?? body.transaction_id;
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

  const { data: groupMembers } = await db
    .from("group_members")
    .select("id")
    .eq("group_id", groupId);

  const memberIds = new Set((groupMembers ?? []).map((m) => m.id));
  const invalidMembers = shares.filter((s) => !memberIds.has(s.memberId));
  if (invalidMembers.length > 0) {
    return NextResponse.json(
      { error: "One or more member IDs do not belong to this group" },
      { status: 400 }
    );
  }

  const { data: tx } = await db
    .from("transactions")
    .select("id, amount, clerk_user_id")
    .eq("id", transactionId)
    .eq("clerk_user_id", userId)
    .single();

  if (!tx) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });

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
    })
    .select("id")
    .single();

  if (splitErr || !split) {
    return NextResponse.json({ error: splitErr?.message ?? "Failed to create split" }, { status: 500 });
  }

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
    await db.from("split_shares").insert(shareRows);
  }

  return NextResponse.json({ id: split.id });
}
