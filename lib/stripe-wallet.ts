import type Stripe from "stripe";

export type WalletBalanceBreakdown = {
  currency: string;
  /** Funds on Coconut platform (Tap to Pay before Connect setup). */
  coconutHeld: number;
  /** Stripe Connect available balance (ready to pay out). */
  stripeAvailable: number | null;
  /** Stripe Connect pending balance (processing). */
  stripePending: number | null;
};

export function centsToMajor(amountCents: number): number {
  return Math.round(amountCents) / 100;
}

/** Pick the largest available bucket or fall back to first. */
export function pickBalanceAmount(
  entries: Stripe.Balance.Available[] | undefined,
  preferredCurrency = "usd"
): { amount: number; currency: string } {
  if (!entries?.length) {
    return { amount: 0, currency: preferredCurrency };
  }
  const pref = preferredCurrency.toLowerCase();
  const match =
    entries.find((e) => (e.currency ?? "").toLowerCase() === pref) ?? entries[0];
  return {
    amount: centsToMajor(match.amount ?? 0),
    currency: (match.currency ?? pref).toLowerCase(),
  };
}

export function sumSettlementAmounts(
  rows: Array<{ amount: number | string; iso_currency_code?: string | null }>,
  currency = "USD"
): number {
  const code = currency.toUpperCase();
  let total = 0;
  for (const row of rows) {
    const rowCode = (row.iso_currency_code ?? "USD").toUpperCase();
    if (rowCode !== code) continue;
    total += Number(row.amount) || 0;
  }
  return Math.round(total * 100) / 100;
}
