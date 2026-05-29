import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getSupabase } from "@/lib/supabase";
import { recordStripeSettlement } from "@/lib/stripe-settlement-record";
import { resolveUserAutoPayoutSettings, tryAutoPayoutForAccount } from "@/lib/stripe-auto-payout";
import { markPaymentRequestPaid } from "@/lib/payment-requests";
import { notifyUsers } from "@/lib/push-sender";
import { connectFlagsFromStripeAccount } from "@/lib/stripe-connect-status";

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const webhookSecretThin = process.env.STRIPE_WEBHOOK_SECRET_THIN;

/**
 * POST /api/stripe/webhook
 * Handles Stripe webhooks for Terminal and Connect events.
 */
export async function POST(req: NextRequest) {
  if (!stripe || !webhookSecret) {
    return NextResponse.json({ error: "Stripe webhook not configured" }, { status: 503 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  let body: string;
  try {
    body = await req.text();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    // Try primary (snapshot) secret first, then thin payload secret
    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret!);
    } catch {
      if (webhookSecretThin) {
        event = stripe.webhooks.constructEvent(body, signature, webhookSecretThin);
      } else {
        throw new Error("Signature verification failed with primary secret");
      }
    }
  } catch (err) {
    console.warn("[stripe-webhook] signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  async function recordFromPaymentIntent(
    pi: Stripe.PaymentIntent,
    source: "terminal" | "payment_link",
  ): Promise<NextResponse | null> {
    const { group_id, payer_member_id, receiver_member_id } = pi.metadata ?? {};
    if (!group_id || !payer_member_id || !receiver_member_id) return null;

    const amountCents = pi.amount_received ?? pi.amount ?? 0;
    const currency = (pi.currency ?? "usd").toUpperCase();
    const result = await recordStripeSettlement({
      groupId: group_id,
      payerMemberId: payer_member_id,
      receiverMemberId: receiver_member_id,
      amount: amountCents / 100,
      currency,
      externalReference: pi.id,
      source,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }


    const paymentRequestId = pi.metadata?.payment_request_id;
    if (paymentRequestId) {
      const prResult = await markPaymentRequestPaid({
        paymentRequestId,
        externalReference: pi.id,
        resolutionMethod: "stripe",
      });
      if (prResult.updated) {
        const { data: pr } = await getSupabase()
          .from("payment_requests")
          .select("label, amount, receiver_member_id, payer_member_id")
          .eq("id", paymentRequestId)
          .maybeSingle();
        if (pr) {
          const { data: members } = await getSupabase()
            .from("group_members")
            .select("id, user_id, display_name")
            .in("id", [pr.receiver_member_id, pr.payer_member_id]);
          const payer = members?.find((m) => m.id === pr.payer_member_id);
          const receiver = members?.find((m) => m.id === pr.receiver_member_id);
          const label = pr.label ?? "your bill";
          const amt = Number(pr.amount).toFixed(2);
          if (receiver?.user_id) {
            void notifyUsers(
              [receiver.user_id],
              "Payment received",
              `${payer?.display_name ?? "Someone"} paid $${amt} for ${label}`,
              { type: "bill_paid", paymentRequestId },
            );
          }
        }
      }
    }

    void maybeAutoPayoutReceiver(receiver_member_id).catch((e) =>
      console.warn("[stripe-webhook] auto-payout check failed:", e instanceof Error ? e.message : e),
    );

    return null;
  }

  async function maybeAutoPayoutReceiver(receiverMemberId: string) {
    if (!stripe) return;
    const db = getSupabase();
    const { data: member } = await db
      .from("group_members")
      .select("user_id")
      .eq("id", receiverMemberId)
      .maybeSingle();
    if (!member?.user_id) return;

    const { data: connect } = await db
      .from("stripe_connected_accounts")
      .select(
        "stripe_account_id, last_auto_payout_at, auto_payout_enabled, auto_payout_threshold_usd",
      )
      .eq("clerk_user_id", member.user_id)
      .eq("payouts_enabled", true)
      .eq("auto_payout_enabled", true)
      .maybeSingle();
    if (!connect?.stripe_account_id) return;

    const userSettings = resolveUserAutoPayoutSettings(connect);
    const attempt = await tryAutoPayoutForAccount({
      stripe,
      db,
      stripeAccountId: connect.stripe_account_id,
      clerkUserId: member.user_id,
      lastAutoPayoutAt: connect.last_auto_payout_at as string | null,
      userSettings,
    });
    if (attempt.status === "triggered") {
      console.log("[stripe-webhook] auto-payout triggered", {
        user: member.user_id,
        payoutId: attempt.payoutId,
        amountUsd: attempt.amountUsd,
      });
    }
  }

  if (event.type === "payment_intent.succeeded") {
    const pi = event.data.object as Stripe.PaymentIntent;
    const source = pi.metadata?.source;
    if (source === "terminal" || source === "payment_link") {
      const errRes = await recordFromPaymentIntent(pi, source);
      if (errRes) return errRes;
    }
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.metadata?.source === "payment_link" && session.payment_intent) {
      const piId =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent.id;
      try {
        const pi = await stripe.paymentIntents.retrieve(piId);
        const errRes = await recordFromPaymentIntent(pi, "payment_link");
        if (errRes) return errRes;
      } catch (e) {
        console.error("[stripe-webhook] checkout.session.completed PI retrieve failed:", e);
        return NextResponse.json({ error: "Could not record settlement" }, { status: 500 });
      }
    }
  }

  if (event.type === "account.updated") {
    const account = event.data.object as Stripe.Account;
    const db = getSupabase();
    const flags = connectFlagsFromStripeAccount(account);

    const { error } = await db
      .from("stripe_connected_accounts")
      .update({
        onboarding_complete: flags.onboarding_complete,
        charges_enabled: flags.charges_enabled,
        payouts_enabled: flags.payouts_enabled,
        details_submitted: flags.details_submitted,
      })
      .eq("stripe_account_id", account.id);

    if (error) {
      console.error("[stripe-webhook] connect account update failed:", error);
    } else {
      console.log("[stripe-webhook] connect account updated", {
        accountId: account.id,
        transferEligibility: flags.transferEligibility,
        charges_enabled: flags.charges_enabled,
        payouts_enabled: flags.payouts_enabled,
        details_submitted: flags.details_submitted,
      });
    }
  }

  return NextResponse.json({ received: true });
}
