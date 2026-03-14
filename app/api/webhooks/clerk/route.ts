import { NextRequest, NextResponse } from "next/server";
import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { offboardUser } from "@/lib/offboard-user";

/**
 * POST /api/webhooks/clerk
 * Handles Clerk webhooks. On user.deleted, calls Plaid item/remove and deletes all user data.
 *
 * Setup: Clerk Dashboard → Webhooks → Add endpoint → Subscribe to user.deleted
 * Add CLERK_WEBHOOK_SIGNING_SECRET to env.
 */
export async function POST(req: NextRequest) {
  try {
    const evt = await verifyWebhook(req);

    if (evt.type === "user.deleted") {
      const userId = evt.data.id;
      if (!userId) {
        return NextResponse.json({ error: "Missing user id" }, { status: 400 });
      }
      await offboardUser(userId);
      console.log("[clerk-webhook] user.deleted offboarded", { user_id: userId });
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("[clerk-webhook] error:", err);
    return NextResponse.json({ error: "Webhook verification failed" }, { status: 400 });
  }
}
