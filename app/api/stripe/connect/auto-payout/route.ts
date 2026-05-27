export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import {
  AUTO_PAYOUT_THRESHOLDS_USD,
  DEFAULT_AUTO_PAYOUT_THRESHOLD_USD,
  isAutoPayoutThresholdUsd,
  resolveUserAutoPayoutSettings,
} from "@/lib/stripe-auto-payout";

/**
 * GET /api/stripe/connect/auto-payout
 * PATCH /api/stripe/connect/auto-payout
 * Body: { enabled: boolean, thresholdUsd?: 25 | 50 | 100 }
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getSupabase();
  const { data: row } = await db
    .from("stripe_connected_accounts")
    .select(
      "payouts_enabled, charges_enabled, auto_payout_enabled, auto_payout_threshold_usd",
    )
    .eq("clerk_user_id", userId)
    .maybeSingle();

  const settings = resolveUserAutoPayoutSettings(row ?? {});
  const canConfigure = Boolean(row?.payouts_enabled);

  return NextResponse.json({
    enabled: settings.enabled,
    thresholdUsd: settings.enabled ? settings.thresholdUsd : row?.auto_payout_threshold_usd ?? null,
    allowedThresholds: AUTO_PAYOUT_THRESHOLDS_USD,
    defaultThresholdUsd: DEFAULT_AUTO_PAYOUT_THRESHOLD_USD,
    canConfigure,
    payoutsEnabled: Boolean(row?.payouts_enabled),
  });
}

export async function PATCH(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { enabled?: boolean; thresholdUsd?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled (boolean) is required" }, { status: 400 });
  }

  const db = getSupabase();
  const { data: row } = await db
    .from("stripe_connected_accounts")
    .select("stripe_account_id, payouts_enabled, auto_payout_threshold_usd")
    .eq("clerk_user_id", userId)
    .maybeSingle();

  if (!row?.stripe_account_id) {
    return NextResponse.json(
      { error: "Set up payouts before configuring automatic transfers." },
      { status: 400 },
    );
  }

  if (body.enabled && !row.payouts_enabled) {
    return NextResponse.json(
      { error: "Add your bank account before enabling automatic transfers." },
      { status: 400 },
    );
  }

  let thresholdUsd: number | null = row.auto_payout_threshold_usd ?? DEFAULT_AUTO_PAYOUT_THRESHOLD_USD;

  if (body.thresholdUsd !== undefined) {
    if (!isAutoPayoutThresholdUsd(body.thresholdUsd)) {
      return NextResponse.json(
        { error: "thresholdUsd must be 25, 50, or 100" },
        { status: 400 },
      );
    }
    thresholdUsd = body.thresholdUsd;
  }

  if (body.enabled) {
    if (body.thresholdUsd === undefined && !isAutoPayoutThresholdUsd(thresholdUsd ?? NaN)) {
      thresholdUsd = DEFAULT_AUTO_PAYOUT_THRESHOLD_USD;
    }
    if (!isAutoPayoutThresholdUsd(thresholdUsd ?? NaN)) {
      return NextResponse.json(
        { error: "Choose a threshold: 25, 50, or 100" },
        { status: 400 },
      );
    }
  } else {
    // Keep stored threshold for next enable; only flip the flag off.
    if (!isAutoPayoutThresholdUsd(thresholdUsd ?? NaN)) {
      thresholdUsd = DEFAULT_AUTO_PAYOUT_THRESHOLD_USD;
    }
  }

  const { error } = await db
    .from("stripe_connected_accounts")
    .update({
      auto_payout_enabled: body.enabled,
      auto_payout_threshold_usd: thresholdUsd,
    })
    .eq("clerk_user_id", userId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const settings = resolveUserAutoPayoutSettings({
    auto_payout_enabled: body.enabled,
    auto_payout_threshold_usd: thresholdUsd,
  });

  return NextResponse.json({
    enabled: settings.enabled,
    thresholdUsd: settings.thresholdUsd,
    allowedThresholds: AUTO_PAYOUT_THRESHOLDS_USD,
  });
}
