export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getSupabase } from "@/lib/supabase";
import { getMaxSettlementAllowed } from "@/lib/group-balances";
import { normalizeSplitCurrency } from "@/lib/split-balances-currency";
import { getUserId } from "@/lib/auth";
import { CACHE_TAGS } from "@/lib/cached-queries";
import { formatCurrency } from "@/lib/currency";
import { notifyGroupMembers } from "@/lib/push-sender";
import { shadowRecordSettlement } from "@/lib/splitwise-shadow";


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

  const { data: result, error: rpcErr } = await db.rpc("insert_settlement_checked", {
    p_clerk_user_id: userId,
    p_group_id: groupId,
    p_payer_member_id: payerMemberId,
    p_receiver_member_id: receiverMemberId,
    p_amount: amountToInsert,
    p_method: method,
    p_currency: currency,
  });

  if (rpcErr) {
    console.error("[settlements] insert_settlement_checked:", rpcErr.message);
    return NextResponse.json({ error: "Operation failed" }, { status: 500 });
  }

  if (result == null || typeof result !== "object" || Array.isArray(result)) {
    console.error("[settlements] insert_settlement_checked: unexpected payload");
    return NextResponse.json({ error: "Operation failed" }, { status: 500 });
  }

  const row = result as Record<string, unknown>;
  if (row.error === "Forbidden") {
    return NextResponse.json(
      { error: "Only the payer or receiver can record this settlement" },
      { status: 403 }
    );
  }

  const settlementId = row.id;
  if (typeof settlementId !== "string") {
    console.error("[settlements] insert_settlement_checked: missing id");
    return NextResponse.json({ error: "Operation failed" }, { status: 500 });
  }

  revalidateTag(CACHE_TAGS.splitTransactions(userId), "max");

  void shadowRecordSettlement({
    clerkUserId: userId,
    groupId,
    payerMemberId,
    receiverMemberId,
    amount: amountToInsert,
    currency,
  }).catch((err) => console.error("[shadow] settlement failed:", err));

  void db
    .from("group_members")
    .select("display_name, email")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .maybeSingle()
    .then(({ data, error }) => {
      if (error) return;
      const name =
        data?.display_name?.trim() ||
        data?.email?.split("@")?.[0] ||
        "Someone";
      void notifyGroupMembers(
        groupId,
        "Settlement recorded",
        `${name} recorded a settlement of ${formatCurrency(amountToInsert, currency)}`,
        userId,
        { type: "settlement", groupId, settlementId }
      );
    });

  return NextResponse.json(result);
}
