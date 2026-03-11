import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getMaxSettlementAllowed } from "@/lib/group-balances";
import { canAccessGroup } from "@/lib/group-access";
import { getUserId } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const groupId = body.groupId ?? body.group_id;
  const payerMemberId = body.payerMemberId ?? body.payer_member_id;
  const receiverMemberId = body.receiverMemberId ?? body.receiver_member_id;
  const amount = Number(body.amount);
  const method = (body.method as string) ?? "manual";

  if (!groupId || !payerMemberId || !receiverMemberId || amount <= 0) {
    return NextResponse.json(
      { error: "groupId, payerMemberId, receiverMemberId, amount required" },
      { status: 400 }
    );
  }

  const canAccess = await canAccessGroup(userId, groupId);
  if (!canAccess) return NextResponse.json({ error: "Group not found" }, { status: 404 });

  const db = getSupabase();

  const { maxAmount, allowed, reason } = await getMaxSettlementAllowed(
    groupId,
    payerMemberId,
    receiverMemberId
  );

  if (!allowed || maxAmount <= 0) {
    return NextResponse.json(
      { error: reason ?? "Nothing left to settle between these members" },
      { status: 400 }
    );
  }

  const amountToInsert = Math.min(Math.round(amount * 100) / 100, maxAmount);

  const { data: settlement, error } = await db
    .from("settlements")
    .insert({
      group_id: groupId,
      payer_member_id: payerMemberId,
      receiver_member_id: receiverMemberId,
      amount: amountToInsert,
      method: ["manual", "in_person", "online"].includes(method) ? method : "manual",
      status: "completed",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const postCheck = await getMaxSettlementAllowed(groupId, payerMemberId, receiverMemberId);
  if (postCheck.maxAmount < 0) {
    await db.from("settlements").delete().eq("id", settlement.id);
    return NextResponse.json(
      { error: "Settlement race detected \u2014 already settled" },
      { status: 409 }
    );
  }

  return NextResponse.json(settlement);
}
