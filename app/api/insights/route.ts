import { NextResponse } from "next/server";
import { getEffectiveUserId } from "@/lib/demo";
import { generateInsights } from "@/lib/insights-engine";
import { rateLimit } from "@/lib/rate-limit";

export async function GET() {
  const userId = await getEffectiveUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = rateLimit(`insights:${userId}`, 10, 60_000);
  if (!rl.success) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  try {
    const insights = await generateInsights(userId);
    return NextResponse.json({ insights });
  } catch (e) {
    console.error("[insights]", e);
    return NextResponse.json({ error: "Failed to generate insights" }, { status: 500 });
  }
}
