import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { canAccessGroup } from "@/lib/group-access";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
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
  const shareSum = shares.reduce((s, sh) => s + Number(sh.amount), 0);
  if (Math.abs(shareSum - totalAmount) > 0.01) {
    return NextResponse.json(
      { error: `Shares must sum to $${totalAmount.toFixed(2)}` },
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

  const shareRows = shares
    .filter((s) => Number(s.amount) > 0)
    .map((s) => ({
      split_transaction_id: split.id,
      member_id: s.memberId,
      amount: Number(s.amount),
    }));

  if (shareRows.length > 0) {
    await db.from("split_shares").insert(shareRows);
  }

  return NextResponse.json({ id: split.id });
}
