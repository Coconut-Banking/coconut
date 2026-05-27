export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import Stripe from "stripe";
import { getSupabase } from "@/lib/supabase";
import {
  buildAccountSessionComponents,
  isConnectEmbeddedEnabled,
  type ConnectEmbeddedMode,
} from "@/lib/stripe-connect-embedded";
import {
  ensureStripeConnectAccount,
  getStripePublishableKey,
} from "@/lib/stripe-connect-account";

const MODES = new Set<ConnectEmbeddedMode>(["onboarding", "payouts", "payments", "all"]);

/**
 * POST /api/stripe/connect/account-session
 * Creates a Stripe Account Session for Connect embedded components (React Native preview).
 * Body: { mode?: "onboarding" | "payouts" | "payments" | "all" }
 */
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isConnectEmbeddedEnabled()) {
    return NextResponse.json(
      { error: "Connect embedded components are not enabled on this server." },
      { status: 503 },
    );
  }

  const key = process.env.STRIPE_SECRET_KEY;
  const publishableKey = getStripePublishableKey();
  if (!key || !publishableKey) {
    return NextResponse.json(
      { error: "Stripe publishable/secret keys not configured." },
      { status: 503 },
    );
  }

  let body: { mode?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const modeRaw = typeof body.mode === "string" ? body.mode : "all";
  const mode: ConnectEmbeddedMode = MODES.has(modeRaw as ConnectEmbeddedMode)
    ? (modeRaw as ConnectEmbeddedMode)
    : "all";

  try {
    const stripe = new Stripe(key);
    const db = getSupabase();
    const user = await currentUser();

    const { accountId } = await ensureStripeConnectAccount({
      stripe,
      db,
      userId,
      email: user?.emailAddresses?.[0]?.emailAddress ?? undefined,
      firstName: user?.firstName ?? undefined,
      lastName: user?.lastName ?? undefined,
      phone: user?.phoneNumbers?.[0]?.phoneNumber ?? undefined,
    });

    const accountSession = await stripe.accountSessions.create({
      account: accountId,
      components: buildAccountSessionComponents(mode),
    });

    return NextResponse.json({
      clientSecret: accountSession.client_secret,
      publishableKey,
      accountId,
      mode,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[stripe-connect] account-session error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
