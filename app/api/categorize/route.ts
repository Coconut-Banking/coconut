import { NextRequest, NextResponse } from "next/server";
import { enrichCategoriesForUser } from "@/lib/transaction-sync";
import { getEffectiveUserId } from "@/lib/demo";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  const effectiveUserId = await getEffectiveUserId();
  if (!effectiveUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = rateLimit(`categorize:${effectiveUserId}`, 3, 60_000);
  if (!rl.success) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let body: { forceAll?: boolean } = {};
  try {
    body = await request.json();
  } catch {
    // default: only re-categorize generic ones
  }

  try {
    const updated = await enrichCategoriesForUser(effectiveUserId, {
      forceAll: body.forceAll ?? false,
    });
    return NextResponse.json({ updated });
  } catch (err) {
    console.error("[categorize]", err);
    return NextResponse.json(
      { error: "Categorization failed" },
      { status: 500 }
    );
  }
}
