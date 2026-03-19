export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { search } from "@/lib/search-engine";
import { getEffectiveUserId } from "@/lib/demo";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  const effectiveUserId = await getEffectiveUserId();
  if (!effectiveUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = rateLimit(`nl-search:${effectiveUserId}`, 20, 60_000);
  if (!rl.success) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
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
