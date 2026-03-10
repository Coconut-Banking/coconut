import { NextRequest, NextResponse } from "next/server";
import { search } from "@/lib/search-engine";
import { getEffectiveUserId } from "@/lib/demo";

export async function POST(request: NextRequest) {
  const effectiveUserId = await getEffectiveUserId();
  if (!effectiveUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { q: rawQ } = body as { q?: string };
  const q = rawQ?.trim()?.slice(0, 500);

  if (!q) {
    return NextResponse.json({ transactions: [], answer: "", metric: "list" });
  }

  try {
    const result = await search(effectiveUserId, q);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[nl-search]", err);
    return NextResponse.json({ transactions: [], answer: "Search failed.", metric: "list" });
  }
}
