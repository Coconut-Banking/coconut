import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getSupabase } from "@/lib/supabase";
import { connectFlagsFromStripeAccount } from "@/lib/stripe-connect-status";

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

/**
 * GET /api/stripe/connect/onboarding-return
 * Stripe redirects here after the user completes (or exits) the hosted onboarding.
 * We sync the account status and redirect to the mobile app via deep link.
 */
export async function GET(req: NextRequest) {
  const accountId = req.nextUrl.searchParams.get("account_id");

  if (accountId && stripe) {
    try {
      const account = await stripe.accounts.retrieve(accountId);
      const db = getSupabase();

      const flags = connectFlagsFromStripeAccount(account);
      await db
        .from("stripe_connected_accounts")
        .update({
          onboarding_complete: flags.onboarding_complete,
          charges_enabled: flags.charges_enabled,
          payouts_enabled: flags.payouts_enabled,
          details_submitted: flags.details_submitted,
        })
        .eq("stripe_account_id", accountId);
    } catch (e) {
      console.error("[stripe-connect] onboarding-return sync error:", e);
    }
  }

  const scheme = req.nextUrl.searchParams.get("scheme") ?? "coconut";

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Redirecting…</title></head>
<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
<p>Redirecting back to Coconut…</p>
<script>
  window.location.href = ${JSON.stringify(scheme)} + "://stripe-connect-return?stripe_connect=complete";
  setTimeout(function() { window.close(); }, 2000);
</script>
</body></html>`;

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html" },
  });
}
