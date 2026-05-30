export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { search } from "@/lib/search-engine";
import { getEffectiveUserId } from "@/lib/demo";
import { rateLimitAsync } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  const [effectiveUserId, body] = await Promise.all([
    getEffectiveUserId(),
    request.json().catch(() => null),
  ]);
  if (!effectiveUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!body) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const rl = await rateLimitAsync(`nl-search:${effectiveUserId}`, 20, 60_000);
  if (!rl.success) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { q: rawQ } = body as { q?: string };
  const q = rawQ?.trim()?.slice(0, 500);

  if (!q) {
    return NextResponse.json({ transactions: [], answer: "", metric: "list" });
  }

  const debug = request.headers.get("X-NL-Search-Debug") === "true";

  try {
    console.log("[pipeline:nl] INPUT", { userId: effectiveUserId, query: q, debug });
    const result = await search(effectiveUserId, q, { debug });
    console.log("[pipeline:nl] OUTPUT", {
      metric: result.metric,
      count: result.transactions.length,
      total: result.total ?? null,
      answer: (result.answer ?? "").slice(0, 100) + ((result.answer?.length ?? 0) > 100 ? "…" : ""),
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[pipeline:nl] ERROR", err);
    return NextResponse.json(
      { transactions: [], answer: "Search failed.", metric: "list" },
      { status: 500 }
    );
  }
}
