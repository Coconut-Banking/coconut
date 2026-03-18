import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getEffectiveUserId } from "@/lib/demo";
import { syncPayPalTransactions } from "@/lib/paypal-sync";
import { CACHE_TAGS } from "@/lib/cached-queries";

export async function POST() {
  const effectiveUserId = await getEffectiveUserId();
  if (!effectiveUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 }
    );
  }
}
