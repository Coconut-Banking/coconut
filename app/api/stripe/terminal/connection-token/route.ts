export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import Stripe from "stripe";

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

/**
 * POST /api/stripe/terminal/connection-token
 * Creates a short-lived Stripe Terminal connection token for the mobile SDK.
 * Required for Tap to Pay on iPhone and other Terminal readers.
 */
export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!stripe) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }

  try {
    const connectionToken = await stripe.terminal.connectionTokens.create();
    return NextResponse.json({ secret: connectionToken.secret });
  } catch (e) {
    console.error("[terminal] connection token error:", e);
    return NextResponse.json(
      { error: "Failed to create connection token" },
      { status: 500 }
    );
  }
}
