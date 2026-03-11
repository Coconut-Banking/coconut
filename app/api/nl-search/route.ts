import { NextRequest, NextResponse } from "next/server";
import { search } from "@/lib/search-engine";
import { getEffectiveUserId } from "@/lib/demo";

export async function POST(request: NextRequest) {
  const effectiveUserId = await getEffectiveUserId();
  if (!effectiveUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  try {
    const result = await search(effectiveUserId, q);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[nl-search]", err);
    return NextResponse.json({ transactions: [], answer: "Search failed.", metric: "list" });
  }
}
