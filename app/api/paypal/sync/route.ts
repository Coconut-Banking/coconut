import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getEffectiveUserId } from "@/lib/demo";
import { syncPayPalTransactions } from "@/lib/paypal-sync";
import { CACHE_TAGS } from "@/lib/cached-queries";
import { rateLimit } from "@/lib/rate-limit";

export async function POST() {
  const effectiveUserId = await getEffectiveUserId();
  if (!effectiveUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = rateLimit(`paypal-sync:${effectiveUserId}`, 5, 60_000);
  if (!rl.success) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  try {
    const result = await syncPayPalTransactions(effectiveUserId);
    if (result.synced > 0) {
      revalidateTag(CACHE_TAGS.transactions(effectiveUserId), "max");
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error("[paypal/sync] Error:", err);
    return NextResponse.json(
      { error: "Sync failed" },
      { status: 500 }
    );
  }
}
