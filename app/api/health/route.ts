import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — lightweight readiness probe (no auth).
 * Does not call external services to avoid rate limits; checks config presence only.
 */
export async function GET() {
  const checks = {
    supabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    supabaseServiceKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    clerk: Boolean(process.env.CLERK_SECRET_KEY),
    plaid: Boolean(process.env.PLAID_CLIENT_ID),
    plaidEnv: process.env.PLAID_ENV ?? "sandbox",
    cronSecret: Boolean(process.env.CRON_SECRET),
    tokenEncryption: Boolean(process.env.TOKEN_ENCRYPTION_KEY?.trim()),
    revenueCatWebhook: Boolean(process.env.REVENUECAT_WEBHOOK_SECRET?.trim()),
  };

  const production = process.env.NODE_ENV === "production";
  const criticalOk =
    checks.supabaseUrl &&
    checks.supabaseServiceKey &&
    checks.clerk &&
    (!production || (checks.cronSecret && checks.tokenEncryption));

  return NextResponse.json(
    {
      ok: criticalOk,
      env: process.env.NODE_ENV ?? "development",
      checks,
    },
    {
      status: criticalOk ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
