export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getSupabase } from "@/lib/supabase";
import { getMaxSettlementAllowed } from "@/lib/group-balances";
import { normalizeSplitCurrency } from "@/lib/split-balances-currency";
import { canAccessGroup } from "@/lib/group-access";
import { getUserId } from "@/lib/auth";
import { CACHE_TAGS } from "@/lib/cached-queries";
import { formatCurrency } from "@/lib/currency";
import { notifyGroupMembers } from "@/lib/push-sender";

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
  const payerMemberId = body.payerMemberId ?? body.payer_member_id;
  const receiverMemberId = body.receiverMemberId ?? body.receiver_member_id;
  const amount = Number(body.amount);
  const method = (body.method as string) ?? "manual";
  const currency = normalizeSplitCurrency(
    typeof body.currency === "string"
      ? body.currency
      : typeof body.iso_currency_code === "string"
        ? body.iso_currency_code
        : "USD"
  );

  if (!groupId || !payerMemberId || !receiverMemberId || !Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { error: "groupId, payerMemberId, receiverMemberId, amount required" },
      { status: 400 }
    );
  }

  const db = getSupabase();

  const [canAccess, { data: partyRows, error: partyErr }] = await Promise.all([
    canAccessGroup(userId, groupId),
    db
      .from("group_members")
      .select("id, display_name, email")
      .eq("group_id", groupId)
      .eq("user_id", userId)
      .in("id", [payerMemberId, receiverMemberId]),
  ]);

  if (!canAccess) return NextResponse.json({ error: "Group not found" }, { status: 404 });

  if (partyErr) {
    console.error("[settlements] party check:", partyErr.message);
    return NextResponse.json({ error: "Operation failed" }, { status: 500 });
  }
  if (!partyRows?.length) {
    return NextResponse.json(
      { error: "Only the payer or receiver can record this settlement" },
      { status: 403 }
    );
  }

  const { maxAmount, allowed, reason } = await getMaxSettlementAllowed(
    groupId,
    payerMemberId,
    receiverMemberId,
    currency
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
      iso_currency_code: currency,
    })
    .select()
    .single();

  if (error) {
    console.error("[settlements] insert:", error.message);
    return NextResponse.json({ error: "Operation failed" }, { status: 500 });
  }

  const postCheck = await getMaxSettlementAllowed(groupId, payerMemberId, receiverMemberId, currency);
  if (postCheck.maxAmount < 0) {
    await db.from("settlements").delete().eq("id", settlement.id);
    return NextResponse.json(
      { error: "Settlement race detected \u2014 already settled" },
      { status: 409 }
    );
  }

  revalidateTag(CACHE_TAGS.splitTransactions(userId), "max");

  const recorderName =
    partyRows?.[0]?.display_name?.trim() ||
    partyRows?.[0]?.email?.split("@")[0] ||
    "Someone";
  void notifyGroupMembers(
    groupId,
    "Settlement recorded",
    `${recorderName} recorded a settlement of ${formatCurrency(amountToInsert, currency)}`,
    userId,
    { type: "settlement", groupId, settlementId: settlement.id }
  );

  return NextResponse.json(settlement);
}
