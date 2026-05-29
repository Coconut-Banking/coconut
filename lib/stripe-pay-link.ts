import Stripe from "stripe";
import { getSupabase } from "./supabase";
import { canAccessGroup } from "./group-access";
import { getMaxSettlementAllowed } from "./group-balances";
import type { PayLinkPayload } from "./pay-link-token";
import { getAppUrl } from "./app-url";

export type PayLinkPreview = {
  amount: number;
  currency: string;
  payerName: string;
  receiverName: string;
  groupName: string;
  description: string;
  expired: boolean;
};

export async function assertUserCanCreatePayLink(
  userId: string,
  groupId: string,
  payerMemberId: string,
  receiverMemberId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const allowed = await canAccessGroup(userId, groupId);
  if (!allowed) return { ok: false, status: 403, error: "Forbidden" };

  const db = getSupabase();
  const { data: members } = await db
    .from("group_members")
    .select("id, user_id, display_name")
    .eq("group_id", groupId)
    .in("id", [payerMemberId, receiverMemberId]);

  if (!members || members.length < 2) {
    return { ok: false, status: 400, error: "Payer or receiver not found in group" };
  }

  const payer = members.find((m) => m.id === payerMemberId);
  const receiver = members.find((m) => m.id === receiverMemberId);
  if (!payer || !receiver) {
    return { ok: false, status: 400, error: "Payer or receiver not found in group" };
  }

  const isPayer = payer.user_id === userId;
  const isReceiver = receiver.user_id === userId;
  if (!isPayer && !isReceiver) {
    return { ok: false, status: 403, error: "You must be the payer or receiver for this payment link" };
  }

  return { ok: true };
}

export async function resolvePayLinkAmount(
  payload: PayLinkPayload,
): Promise<{ ok: true; amount: number } | { ok: false; status: number; error: string }> {
  const currency = payload.currency.toUpperCase();
  const { maxAmount, allowed, reason } = await getMaxSettlementAllowed(
    payload.groupId,
    payload.payerMemberId,
    payload.receiverMemberId,
    currency,
  );

  if (!allowed || maxAmount <= 0) {
    return { ok: false, status: 400, error: reason ?? "Nothing left to settle" };
  }

  const amount = Math.min(payload.amount, maxAmount);
  if (amount < 0.01) {
    return { ok: false, status: 400, error: "Amount too small" };
  }

  return { ok: true, amount: Math.round(amount * 100) / 100 };
}

export async function getPayLinkPreview(payload: PayLinkPayload): Promise<PayLinkPreview> {
  const db = getSupabase();
  const [{ data: group }, { data: members }] = await Promise.all([
    db.from("groups").select("name").eq("id", payload.groupId).maybeSingle(),
    db
      .from("group_members")
      .select("id, display_name")
      .eq("group_id", payload.groupId)
      .in("id", [payload.payerMemberId, payload.receiverMemberId]),
  ]);

  const payer = members?.find((m) => m.id === payload.payerMemberId);
  const receiver = members?.find((m) => m.id === payload.receiverMemberId);
  const payerName = payer?.display_name ?? "Someone";
  const receiverName = receiver?.display_name ?? "Someone";
  const groupName = group?.name ?? "Coconut";

  return {
    amount: payload.amount,
    currency: payload.currency,
    payerName,
    receiverName,
    groupName,
    description: `Pay ${receiverName} via Coconut`,
    expired: Date.now() > payload.exp,
  };
}

async function lookupDestinationAccount(receiverMemberId: string): Promise<string | null> {
  const db = getSupabase();
  const { data: receiverMember } = await db
    .from("group_members")
    .select("user_id")
    .eq("id", receiverMemberId)
    .maybeSingle();

  if (!receiverMember?.user_id) return null;

  const { data: connectAccount } = await db
    .from("stripe_connected_accounts")
    .select("stripe_account_id")
    .eq("clerk_user_id", receiverMember.user_id)
    .eq("charges_enabled", true)
    .maybeSingle();

  return connectAccount?.stripe_account_id ?? null;
}

export async function createPayLinkCheckoutSession(
  stripe: Stripe,
  payload: PayLinkPayload,
  token: string,
  opts?: { paymentRequestId?: string },
): Promise<{ url: string; sessionId: string }> {
  const amountResult = await resolvePayLinkAmount(payload);
  if (!amountResult.ok) {
    throw new PayLinkCheckoutError(amountResult.error, amountResult.status);
  }

  const amount = amountResult.amount;
  const currency = payload.currency.toLowerCase();
  const amountCents = Math.round(amount * 100);
  const preview = await getPayLinkPreview(payload);
  const appUrl = getAppUrl();
  const destinationAccountId = await lookupDestinationAccount(payload.receiverMemberId);

  const metadata: Record<string, string> = {
    group_id: payload.groupId,
    payer_member_id: payload.payerMemberId,
    receiver_member_id: payload.receiverMemberId,
    source: "payment_link",
    ...(opts?.paymentRequestId ? { payment_request_id: opts.paymentRequestId } : {}),
  };

  const paymentIntentData: Stripe.Checkout.SessionCreateParams.PaymentIntentData = {
    metadata,
  };

  if (destinationAccountId) {
    paymentIntentData.transfer_data = { destination: destinationAccountId };
  }

  const encodedToken = encodeURIComponent(token);
  const successUrl = `${appUrl}/pay/${encodedToken}?paid=1`;
  const cancelUrl = `${appUrl}/pay/${encodedToken}?cancelled=1`;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency,
            unit_amount: amountCents,
            product_data: {
              name: preview.description,
              description: `${preview.groupName} · Coconut settlement`,
            },
          },
          quantity: 1,
        },
      ],
      payment_intent_data: paymentIntentData,
      metadata,
      success_url: successUrl,
      cancel_url: cancelUrl,
      payment_method_types: ["card"],
    });

    if (!session.url) {
      throw new PayLinkCheckoutError("Checkout session missing URL", 500);
    }

    return { url: session.url, sessionId: session.id };
  } catch (e) {
    if (e instanceof PayLinkCheckoutError) throw e;
    if (
      destinationAccountId &&
      e instanceof Stripe.errors.StripeError &&
      e.message.includes("transfer")
    ) {
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency,
              unit_amount: amountCents,
              product_data: {
                name: preview.description,
                description: `${preview.groupName} · Coconut settlement`,
              },
            },
            quantity: 1,
          },
        ],
        payment_intent_data: { metadata },
        metadata,
        success_url: successUrl,
        cancel_url: cancelUrl,
        payment_method_types: ["card"],
      });
      if (!session.url) throw new PayLinkCheckoutError("Checkout session missing URL", 500);
      return { url: session.url, sessionId: session.id };
    }
    const msg = e instanceof Stripe.errors.StripeError ? e.message : "Payment failed";
    throw new PayLinkCheckoutError(msg, 500);
  }
}

export async function createPayLinkPaymentIntent(
  stripe: Stripe,
  payload: PayLinkPayload,
  opts?: { paymentRequestId?: string },
): Promise<{ clientSecret: string; paymentIntentId: string }> {
  const amountResult = await resolvePayLinkAmount(payload);
  if (!amountResult.ok) {
    throw new PayLinkCheckoutError(amountResult.error, amountResult.status);
  }

  const amountCents = Math.round(amountResult.amount * 100);
  const currency = payload.currency.toLowerCase();
  const destinationAccountId = await lookupDestinationAccount(payload.receiverMemberId);

  const metadata: Record<string, string> = {
    group_id: payload.groupId,
    payer_member_id: payload.payerMemberId,
    receiver_member_id: payload.receiverMemberId,
    source: "payment_link",
    ...(opts?.paymentRequestId ? { payment_request_id: opts.paymentRequestId } : {}),
  };

  const baseParams: Stripe.PaymentIntentCreateParams = {
    amount: amountCents,
    currency,
    metadata,
    automatic_payment_methods: { enabled: true },
  };

  const create = async (withTransfer: boolean) => {
    const params: Stripe.PaymentIntentCreateParams = { ...baseParams };
    if (withTransfer && destinationAccountId) {
      params.transfer_data = { destination: destinationAccountId };
    }
    return stripe.paymentIntents.create(params);
  };

  try {
    const pi = await create(Boolean(destinationAccountId));
    if (!pi.client_secret) {
      throw new PayLinkCheckoutError("Payment intent missing client secret", 500);
    }
    return { clientSecret: pi.client_secret, paymentIntentId: pi.id };
  } catch (e) {
    if (e instanceof PayLinkCheckoutError) throw e;
    if (
      destinationAccountId &&
      e instanceof Stripe.errors.StripeError &&
      e.message.includes("transfer")
    ) {
      const pi = await create(false);
      if (!pi.client_secret) {
        throw new PayLinkCheckoutError("Payment intent missing client secret", 500);
      }
      return { clientSecret: pi.client_secret, paymentIntentId: pi.id };
    }
    const msg = e instanceof Stripe.errors.StripeError ? e.message : "Payment failed";
    throw new PayLinkCheckoutError(msg, 500);
  }
}

export class PayLinkCheckoutError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
