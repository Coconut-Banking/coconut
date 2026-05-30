import { getSupabase } from "./supabase";

export type StripeSettlementSource = "terminal" | "payment_link";

type RpcSettlementRow = Record<string, unknown>;

function parseRpcRow(
  result: unknown,
): { ok: true; row: RpcSettlementRow } | { ok: false; status: number; error: string } {
  if (result == null || typeof result !== "object" || Array.isArray(result)) {
    return { ok: false, status: 500, error: "Unexpected RPC response" };
  }
  const row = result as RpcSettlementRow;
  if (typeof row.error === "string") {
    const status =
      row.error === "external_reference required" ||
      row.error === "Already settled between these members in this currency" ||
      row.error === "Amount too small" ||
      row.error === "Invalid amount"
        ? 400
        : 500;
    return { ok: false, status, error: row.error };
  }
  if (typeof row.id !== "string") {
    return { ok: false, status: 500, error: "Missing settlement id" };
  }
  return { ok: true, row };
}

/**
 * Record a completed Stripe payment as a settlement.
 * Idempotent via external_reference. Amount capped under advisory lock (race-safe).
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
  const requestedAmount = Math.round(params.amount * 100) / 100;

  const { data: result, error: rpcErr } = await db.rpc("insert_stripe_settlement_checked", {
    p_group_id: params.groupId,
    p_payer_member_id: params.payerMemberId,
    p_receiver_member_id: params.receiverMemberId,
    p_amount: requestedAmount,
    p_currency: currency,
    p_external_reference: params.externalReference,
  });

  if (rpcErr) {
    console.error(`[stripe-settlement] RPC failed (${params.source}):`, rpcErr.message);
    return { ok: false, status: 500, error: "DB insert failed" };
  }

  const parsed = parseRpcRow(result);
  if (!parsed.ok) {
    console.error(`[stripe-settlement] not allowed (${params.source}):`, parsed.error);
    return { ok: false, status: parsed.status, error: parsed.error };
  }

  const { row } = parsed;
  if (row.already_exists === true) {
    return { ok: true, amountRecorded: 0 };
  }

  const recorded =
    typeof row.amount === "number"
      ? row.amount
      : typeof row.amount === "string"
        ? Number(row.amount)
        : requestedAmount;

  console.log(`[stripe-settlement] recorded (${params.source})`, {
    group_id: params.groupId,
    amount: recorded,
    ref: params.externalReference,
  });

  return { ok: true, amountRecorded: Number.isFinite(recorded) ? recorded : requestedAmount };
}
