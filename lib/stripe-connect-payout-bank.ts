import type Stripe from "stripe";

export type ConnectPayoutBank = {
  bankName: string | null;
  last4: string | null;
};

/** Default external bank account Stripe pays out to (Express Connect). */
export async function fetchConnectPayoutBank(
  stripe: Stripe,
  stripeAccountId: string,
): Promise<ConnectPayoutBank | null> {
  try {
    const list = await stripe.accounts.listExternalAccounts(stripeAccountId, {
      object: "bank_account",
      limit: 10,
    });
    const banks = list.data.filter((a) => a.object === "bank_account") as Stripe.BankAccount[];
    if (banks.length === 0) return null;

    const preferred = banks.find((b) => b.default_for_currency) ?? banks[0];

    return {
      bankName: preferred.bank_name ?? null,
      last4: preferred.last4 ?? null,
    };
  } catch (e) {
    console.warn("[stripe-connect] payout bank lookup failed:", e);
    return null;
  }
}
