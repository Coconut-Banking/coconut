export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import Stripe from "stripe";
import { DEFAULT_CURRENCY } from "@/lib/currency";
import { canAccessGroup } from "@/lib/group-access";
import { getSupabase } from "@/lib/supabase";

/**
 * POST /api/stripe/terminal/create-payment-intent
 * Creates a PaymentIntent for Stripe Terminal (Tap to Pay).
 * Body: { amount: number, groupId?, payerMemberId?, receiverMemberId? }
 * When settlement metadata is provided, the webhook will record the settlement on success.
 */
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }

  let body: {
    amount: number;
    currency?: string;
    groupId?: string;
    payerMemberId?: string;
    receiverMemberId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Valid amount required" }, { status: 400 });
  }

  const amountCents = Math.round(amount * 100);
  const stripe = new Stripe(key);
  const db = getSupabase();

  const metadata: Record<string, string> = {};
  if (body.groupId && body.payerMemberId && body.receiverMemberId) {
    const allowed = await canAccessGroup(userId, body.groupId);
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: groupMembers } = await db
      .from("group_members")
      .select("id")
      .eq("group_id", body.groupId)
      .in("id", [body.payerMemberId, body.receiverMemberId]);

    if (!groupMembers || groupMembers.length < 2) {
      return NextResponse.json(
        { error: "Payer or receiver not found in group" },
        { status: 400 }
      );
    }

    metadata.group_id = body.groupId;
    metadata.payer_member_id = body.payerMemberId;
    metadata.receiver_member_id = body.receiverMemberId;
    metadata.source = "terminal";
  }

  // Look up the receiver's Stripe Connected Account for direct payouts
  let destinationAccountId: string | null = null;
  if (body.receiverMemberId) {
    const { data: receiverMember } = await db
      .from("group_members")
      .select("user_id")
      .eq("id", body.receiverMemberId)
      .maybeSingle();

    if (receiverMember?.user_id) {
      const { data: connectAccount } = await db
        .from("stripe_connected_accounts")
        .select("stripe_account_id")
        .eq("clerk_user_id", receiverMember.user_id)
        .eq("onboarding_complete", true)
        .maybeSingle();

      if (connectAccount) {
        destinationAccountId = connectAccount.stripe_account_id;
      }
    }
  }

  // Stripe Terminal (card_present) requires the PaymentIntent currency to match
  // the Stripe account's country — e.g. a CA account MUST use "cad", even if
  // the expense itself is denominated in USD. We always derive the Terminal
  // currency from the account country and store the original expense currency
  // in metadata so settlement logic can reconcile later.
  const clientCurrency = typeof body.currency === "string" && /^[a-zA-Z]{3}$/.test(body.currency)
    ? body.currency.toLowerCase()
    : null;

  const COUNTRY_TO_CURRENCY: Record<string, string> = {
    CA: "cad", US: "usd", GB: "gbp", AU: "aud", NZ: "nzd",
    SG: "sgd", HK: "hkd", JP: "jpy", EU: "eur",
    DE: "eur", FR: "eur", IT: "eur", ES: "eur", NL: "eur",
    IE: "eur", AT: "eur", BE: "eur", FI: "eur", PT: "eur",
  };

  let currency = DEFAULT_CURRENCY;
  try {
    const acct = await stripe.accounts.retrieve();
    const country = (acct.country ?? "").toUpperCase();
    currency = COUNTRY_TO_CURRENCY[country] ?? DEFAULT_CURRENCY;
  } catch {
    // Fallback to default
  }

  if (clientCurrency && clientCurrency !== currency) {
    metadata.original_currency = clientCurrency;
  }

  try {
    const piParams: Stripe.PaymentIntentCreateParams = {
      amount: amountCents,
      currency,
      metadata,
      payment_method_types: ["card_present"],
      capture_method: "automatic",
    };

    if (destinationAccountId) {
      piParams.transfer_data = { destination: destinationAccountId };
    }

    const paymentIntent = await stripe.paymentIntents.create(piParams);
    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      directPayout: !!destinationAccountId,
      paymentIntentId: paymentIntent.id,
      currency,
    });
  } catch (e) {
    const stripeMsg = e instanceof Stripe.errors.StripeError ? e.message : null;
    const stripeCode = e instanceof Stripe.errors.StripeError ? e.code : null;
    console.error("[terminal] create payment intent error:", stripeMsg ?? e);
    if (stripeCode) console.error("[terminal] stripe code:", stripeCode);

    // If the connected account is invalid, retry without transfer_data
    if (destinationAccountId && stripeMsg?.includes("transfer")) {
      console.warn("[terminal] retrying without transfer_data");
      try {
        const fallbackParams: Stripe.PaymentIntentCreateParams = {
          amount: amountCents,
          currency,
          metadata,
          payment_method_types: ["card_present"],
          capture_method: "automatic",
        };
        const pi = await stripe.paymentIntents.create(fallbackParams);
        return NextResponse.json({
          clientSecret: pi.client_secret,
          directPayout: false,
          paymentIntentId: pi.id,
        });
      } catch (e2) {
        const msg2 = e2 instanceof Stripe.errors.StripeError ? e2.message : "Payment failed";
        console.error("[terminal] fallback also failed:", msg2);
        return NextResponse.json({ error: msg2 }, { status: 500 });
      }
    }

    return NextResponse.json(
      { error: stripeMsg ?? "Payment failed" },
      { status: 500 }
    );
  }
}
