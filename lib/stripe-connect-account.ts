import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ConnectAccountRow = {
  stripe_account_id: string;
  onboarding_complete: boolean;
};

/**
 * Returns an existing Express connected account id, or creates one for the user.
 */
export async function ensureStripeConnectAccount(params: {
  stripe: Stripe;
  db: SupabaseClient;
  userId: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
}): Promise<{ accountId: string; created: boolean }> {
  const { stripe, db, userId } = params;

  const { data: existing, error: selectError } = await db
    .from("stripe_connected_accounts")
    .select("stripe_account_id, onboarding_complete")
    .eq("clerk_user_id", userId)
    .maybeSingle();

  if (selectError) {
    throw new Error(`Database error: ${selectError.message}`);
  }

  if (existing?.stripe_account_id) {
    return { accountId: existing.stripe_account_id, created: false };
  }

  const account = await stripe.accounts.create({
    type: "express",
    country: "US",
    email: params.email,
    business_type: "individual",
    business_profile: {
      url: "https://coconut-app.dev",
      mcc: "7372",
      product_description: "Peer-to-peer expense splitting and payments via the Coconut app",
    },
    individual: {
      email: params.email,
      first_name: params.firstName,
      last_name: params.lastName,
      phone: params.phone,
      relationship: {
        title: "Individual",
      },
    },
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    settings: {
      payouts: {
        schedule: { interval: "daily" },
      },
    },
    metadata: { clerk_user_id: userId },
  });

  const { error: insertError } = await db.from("stripe_connected_accounts").insert({
    clerk_user_id: userId,
    stripe_account_id: account.id,
    onboarding_complete: false,
    charges_enabled: false,
    payouts_enabled: false,
  });

  if (insertError) {
    throw new Error(`Failed to save account: ${insertError.message}`);
  }

  return { accountId: account.id, created: true };
}

export function getStripePublishableKey(): string | null {
  return (
    process.env.STRIPE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ??
    null
  );
}
