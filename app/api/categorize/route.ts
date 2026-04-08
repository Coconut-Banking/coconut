export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { enrichCategoriesForUser } from "@/lib/transaction-sync";
import { getEffectiveUserId } from "@/lib/demo";
import { rateLimit } from "@/lib/rate-limit";
import { CACHE_TAGS } from "@/lib/cached-queries";

export async function POST(request: NextRequest) {
  const [effectiveUserId, body] = await Promise.all([
    getEffectiveUserId(),
    request.json().catch(() => null),
  ]);
  if (!effectiveUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = rateLimit(`categorize:${effectiveUserId}`, 3, 60_000);
  if (!rl.success) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const typedBody: { forceAll?: boolean } = body ?? {};

  try {
    const updated = await enrichCategoriesForUser(effectiveUserId, {
      forceAll: typedBody.forceAll ?? false,
    });
    if (updated > 0) {
      revalidateTag(CACHE_TAGS.transactions(effectiveUserId), "max");
    }
    return NextResponse.json({ updated });
  } catch (err) {
    console.error("[categorize]", err);
    return NextResponse.json(
      { error: "Categorization failed" },
      { status: 500 }
    );
  }
}
