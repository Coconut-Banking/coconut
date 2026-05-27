import type Stripe from "stripe";

export type ConnectEmbeddedMode = "onboarding" | "payouts" | "payments" | "all";

export function isConnectEmbeddedEnabled(): boolean {
  return process.env.STRIPE_CONNECT_EMBEDDED_ENABLED !== "false";
}

export function buildAccountSessionComponents(
  mode: ConnectEmbeddedMode,
): Stripe.AccountSessionCreateParams.Components {
  const onboarding = {
    enabled: true as const,
    features: {
      disable_stripe_user_authentication: true,
    },
  };

  const payouts = { enabled: true as const };
  const payments = {
    enabled: true as const,
    features: {
      refund_management: true,
      dispute_management: true,
      capture_payments: true,
    },
  };

  switch (mode) {
    case "onboarding":
      return { account_onboarding: onboarding };
    case "payouts":
      return { payouts, balances: { enabled: true } };
    case "payments":
      return { payments };
    case "all":
      return {
        account_onboarding: onboarding,
        payouts,
        payments,
        balances: { enabled: true },
      };
  }
}
