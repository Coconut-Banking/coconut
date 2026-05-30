import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

function getWebhookSecret(): string | undefined {
  const secret = process.env.REVENUECAT_WEBHOOK_SECRET?.trim();
  return secret || undefined;
}

/**
 * POST /api/webhooks/revenuecat
 *
 * Receives subscription lifecycle events from RevenueCat.
 * Updates users.tier based on whether the user has an active "pro" entitlement.
 *
 * Events handled:
 *   - INITIAL_PURCHASE, RENEWAL, UNCANCELLATION, PRODUCT_CHANGE → tier = "pro"
 *   - EXPIRATION, CANCELLATION, BILLING_ISSUE → tier = "free"
 *
 * See: https://www.revenuecat.com/docs/integrations/webhooks
 *
 * Optional: set REVENUECAT_WEBHOOK_SECRET when Pro subscriptions are enabled.
 * Without it, events are acknowledged but tier is not updated (app stays free-tier).
 */
export async function POST(req: NextRequest) {
  const webhookSecret = getWebhookSecret();
  if (!webhookSecret) {
    return NextResponse.json({ ok: true, subscriptions: "disabled" });
  }

  const authHeader = req.headers.get("authorization") ?? "";
  if (authHeader !== `Bearer ${webhookSecret}`) {
    console.warn("[revenuecat-webhook] Invalid auth header");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const event = body?.event;
  if (!event) {
    return NextResponse.json({ ok: true });
  }

  const eventType: string = event.type ?? "";
  const appUserId: string = event.app_user_id ?? "";

  if (!appUserId) {
    console.warn("[revenuecat-webhook] No app_user_id in event", { eventType });
    return NextResponse.json({ ok: true });
  }

  const activateEvents = new Set([
    "INITIAL_PURCHASE",
    "RENEWAL",
    "UNCANCELLATION",
    "PRODUCT_CHANGE",
    "NON_RENEWING_PURCHASE",
  ]);

  const deactivateEvents = new Set([
    "EXPIRATION",
    "CANCELLATION",
    "BILLING_ISSUE",
  ]);

  let newTier: "pro" | "free" | null = null;

  if (activateEvents.has(eventType)) {
    newTier = "pro";
  } else if (deactivateEvents.has(eventType)) {
    newTier = "free";
  }

  if (newTier && appUserId) {
    const db = getSupabaseAdmin();
    const { error } = await db
      .from("users")
      .update({ tier: newTier })
      .eq("clerk_user_id", appUserId);

    if (error) {
      console.error("[revenuecat-webhook] DB update failed:", error.message, { appUserId, newTier, eventType });
    } else {
      console.log("[revenuecat-webhook] Updated tier", { appUserId, newTier, eventType });
    }
  } else {
    console.log("[revenuecat-webhook] Unhandled event type:", eventType);
  }

  return NextResponse.json({ ok: true });
}
