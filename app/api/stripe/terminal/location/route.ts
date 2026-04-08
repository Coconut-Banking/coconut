export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import Stripe from "stripe";

const DEFAULT_ADDRESSES: Record<string, Stripe.Terminal.LocationCreateParams["address"]> = {
  CA: { line1: "123 Main St", city: "Toronto", state: "ON", postal_code: "M5V 1A1", country: "CA" },
  US: { line1: "123 Main St", city: "San Francisco", state: "CA", postal_code: "94102", country: "US" },
  GB: { line1: "1 High Street", city: "London", postal_code: "EC1A 1BB", country: "GB" },
  AU: { line1: "1 George St", city: "Sydney", state: "NSW", postal_code: "2000", country: "AU" },
};

/**
 * GET /api/stripe/terminal/location
 * Returns a Stripe Terminal location whose country matches the Stripe
 * account's country. Tap to Pay requires this match or processPaymentIntent
 * fails with terminal_reader_invalid_location_for_payment.
 * Creates one if none exist for the account's country.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }

  const stripe = new Stripe(key);

  try {
    const [acct, { data: locations }] = await Promise.all([
      stripe.accounts.retrieve(),
      stripe.terminal.locations.list({ limit: 100 }),
    ]);
    const accountCountry = (acct.country ?? "US").toUpperCase();

    // Find an existing location in the account's country
    const match = locations.find(
      (loc) => (loc.address?.country ?? "").toUpperCase() === accountCountry
    );

    if (match) {
      return NextResponse.json({ locationId: match.id });
    }

    // No location in the right country — create one
    const address = DEFAULT_ADDRESSES[accountCountry] ?? {
      line1: "1 Main St",
      city: "Default",
      postal_code: "00000",
      country: accountCountry,
    };
    const location = await stripe.terminal.locations.create({
      display_name: `Default (${accountCountry})`,
      address,
    });
    return NextResponse.json({ locationId: location.id });
  } catch (e) {
    console.error("[terminal] location error:", e);
    return NextResponse.json(
      { error: "Failed to get location" },
      { status: 500 }
    );
  }
}
