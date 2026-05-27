import { getSupabase } from "./supabase";
import { createPayLinkToken, payLinkPublicUrl } from "./pay-link-token";

export async function markPaymentRequestPaid(params: {
  paymentRequestId: string;
  externalReference: string;
  resolutionMethod?: "stripe" | "manual";
}): Promise<{ updated: boolean }> {
  const db = getSupabase();
  const { data: existing } = await db
    .from("payment_requests")
    .select("id, status")
    .eq("id", params.paymentRequestId)
    .maybeSingle();
  if (!existing || existing.status === "paid") return { updated: false };
  const { error } = await db
    .from("payment_requests")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      external_reference: params.externalReference,
      resolution_method: params.resolutionMethod ?? "stripe",
    })
    .eq("id", params.paymentRequestId)
    .in("status", ["pending", "settled_off_link"]);
  return { updated: !error };
}

export async function createPaymentRequestWithPayLink(input: {
  groupId: string;
  payerMemberId: string;
  receiverMemberId: string;
  amount: number;
  currency?: string;
  label?: string;
  receiptScanId?: string;
  collectSessionId?: string;
}): Promise<{ id: string; payUrl: string; token: string } | null> {
  const db = getSupabase();
  const currency = (input.currency ?? "USD").toUpperCase();
  const amount = Math.round(input.amount * 100) / 100;
  const token = createPayLinkToken({
    groupId: input.groupId,
    payerMemberId: input.payerMemberId,
    receiverMemberId: input.receiverMemberId,
    amount,
    currency,
  });
  const { data, error } = await db
    .from("payment_requests")
    .insert({
      group_id: input.groupId,
      payer_member_id: input.payerMemberId,
      receiver_member_id: input.receiverMemberId,
      amount,
      currency,
      label: input.label ?? null,
      receipt_scan_id: input.receiptScanId ?? null,
      collect_session_id: input.collectSessionId ?? null,
      status: "pending",
      pay_link_token: token,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[payment-requests] insert failed:", error);
    return null;
  }
  return { id: data.id, payUrl: payLinkPublicUrl(token), token };
}

export function payUrlForStoredToken(token: string | null): string | null {
  if (!token) return null;
  return payLinkPublicUrl(token);
}
