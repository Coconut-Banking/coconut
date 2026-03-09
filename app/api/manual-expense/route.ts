import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { canAccessGroup } from "@/lib/group-access";
import { getUserId } from "@/lib/auth";
import { randomUUID } from "crypto";

/**
 * POST /api/manual-expense
 * Create a manual expense and split it in a group.
 * Body: { amount: number, description: string, groupId: string, personKey?: string }
 * - If personKey provided: split between current user and that person (50/50)
 * - Else: split equally among all group members
 */
export async function POST(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const groupId = body.groupId ?? body.group_id;
  const amount = Number(body.amount);
  const description = (body.description ?? "Expense").toString().trim() || "Expense";
  const personKey = body.personKey ?? body.person_key;

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

  const payerMember = members.find((m) => m.user_id === userId);
  if (!payerMember) {
    return NextResponse.json({ error: "You are not a member of this group" }, { status: 400 });
  }

  let shareMemberIds: string[];
  if (personKey) {
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
    shareMemberIds = [payerMember.id, otherMember.id];
  } else {
    shareMemberIds = members.map((m) => m.id);
  }

  const sharePerPerson = Math.floor((amount / shareMemberIds.length) * 100) / 100;
  const remainder = Math.round((amount - sharePerPerson * shareMemberIds.length) * 100) / 100;
  const shares = shareMemberIds.map((id, i) => ({
    memberId: id,
    amount: i === 0 ? sharePerPerson + remainder : sharePerPerson,
  }));

  const plaidId = `manual_${randomUUID()}`;

  const { data: transaction, error: txError } = await db
    .from("transactions")
    .insert({
      clerk_user_id: userId,
      plaid_transaction_id: plaidId,
      merchant_name: description,
      raw_name: description,
      amount: -amount,
      date: new Date().toISOString().split("T")[0],
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

  const { data: splitTx, error: splitError } = await db
    .from("split_transactions")
    .insert({
      group_id: groupId,
      transaction_id: transaction.id,
      created_by: userId,
    })
    .select("id")
    .single();

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

  return NextResponse.json({ id: splitTx.id });
}
