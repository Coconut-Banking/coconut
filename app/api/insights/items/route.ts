export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getEffectiveUserId } from "@/lib/demo";
import { detectItemTrends } from "@/lib/item-insights";
import { rateLimit } from "@/lib/rate-limit";

export async function GET() {
  const userId = await getEffectiveUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = rateLimit(`item-insights:${userId}`, 10, 60_000);
  if (!rl.success) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  try {
    const insights = await detectItemTrends(userId);
    return NextResponse.json({ insights }, {
      headers: { "Cache-Control": "private, max-age=300, stale-while-revalidate=60" },
    });
  } catch (e) {
    console.error("[item-insights]", e);
    return NextResponse.json(
      { error: "Failed to generate insights", insights: [] },
      { status: 500 }
    );
  }
}
