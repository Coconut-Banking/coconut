export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import Stripe from "stripe";

/**
 * GET /api/stripe/terminal/location
 * Returns the first Stripe Terminal location ID for Tap to Pay.
 * Tap to Pay on iPhone requires a location when connecting the reader.
 * If no location exists, creates one.
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
    const { data: locations } = await stripe.terminal.locations.list({ limit: 1 });

    if (locations.length > 0) {
      return NextResponse.json({ locationId: locations[0].id });
    }

    // Create a default location if none exist (required for Tap to Pay)
    const location = await stripe.terminal.locations.create({
      display_name: "Default",
      address: {
        line1: "123 Main St",
        city: "San Francisco",
        state: "CA",
        postal_code: "94102",
        country: "US",
      },
    });
    return NextResponse.json({ locationId: location.id });
  } catch (e) {
    console.error("[terminal] location error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to get Terminal location" },
      { status: 500 }
    );
  }
}
