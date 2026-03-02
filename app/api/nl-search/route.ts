import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { search } from "@/lib/search-engine";

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { q } = body as { q?: string };

  if (!q?.trim()) {
    return NextResponse.json({ transactions: [], answer: "", metric: "list" });
  }

  try {
    const result = await search(userId, q.trim());
    return NextResponse.json(result);
  } catch (err) {
    console.error("[nl-search]", err);
    return NextResponse.json({ transactions: [], answer: "Search failed.", metric: "list" });
  }
}
