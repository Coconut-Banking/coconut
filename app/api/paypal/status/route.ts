export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getEffectiveUserId } from "@/lib/demo";
import { getPayPalStatus } from "@/lib/paypal-auth";

export async function GET() {
  const effectiveUserId = await getEffectiveUserId();
  if (!effectiveUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const status = await getPayPalStatus(effectiveUserId);
    return NextResponse.json(status);
  } catch (e) {
    console.error("[paypal/status]", e);
    return NextResponse.json({ connected: false, email: null, lastSyncAt: null });
  }
}
