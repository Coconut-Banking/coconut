import { getSupabase } from "./supabase";
import { getMaxSettlementAllowed } from "./group-balances";

export type StripeSettlementSource = "terminal" | "payment_link";

/**
 * Record a completed Stripe payment as a settlement.
 * Idempotent via external_reference. Caps amount to max allowed balance.
 */
export async function recordStripeSettlement(params: {
  groupId: string;
  payerMemberId: string;
  receiverMemberId: string;
  amount: number;
  currency: string;
  externalReference: string;
  source: StripeSettlementSource;
}): Promise<{ ok: true; amountRecorded: number } | { ok: false; status: number; error: string }> {
  const db = getSupabase();
  const currency = params.currency.toUpperCase();

  const { data: existing } = await db
    .from("settlements")
    .select("id")
    .eq("external_reference", params.externalReference)
    .maybeSingle();

  if (existing) return { ok: true, amountRecorded: 0 };

  const { maxAmount, allowed, reason } = await getMaxSettlementAllowed(
    params.groupId,
    params.payerMemberId,
    params.receiverMemberId,
    currency,
  );

  if (!allowed || maxAmount <= 0) {
    console.error(`[stripe-settlement] not allowed (${params.source}):`, { allowed, maxAmount, reason });
    return { ok: false, status: 500, error: "Settlement validation failed" };
  }

  const amountToInsert = Math.min(params.amount, maxAmount);
  const { error } = await db.from("settlements").insert({
    group_id: params.groupId,
    payer_member_id: params.payerMemberId,
    receiver_member_id: params.receiverMemberId,
    amount: Math.round(amountToInsert * 100) / 100,
    method: "stripe",
    status: "completed",
    external_reference: params.externalReference,
    iso_currency_code: currency,
  });

  if (error) {
    console.error(`[stripe-settlement] insert failed (${params.source}):`, error);
    return { ok: false, status: 500, error: "DB insert failed" };
  }

  console.log(`[stripe-settlement] recorded (${params.source})`, {
    group_id: params.groupId,
    amount: amountToInsert,
    ref: params.externalReference,
  });

  return { ok: true, amountRecorded: amountToInsert };
}
