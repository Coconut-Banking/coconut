import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { search } from "@/lib/search-engine";

const DEMO_USER_ID = "demo-sandbox-user";

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  const effectiveUserId = userId ?? DEMO_USER_ID;

  const body = await request.json();
  const { q } = body as { q?: string };

  if (!q?.trim()) {
    return NextResponse.json({ transactions: [], answer: "", metric: "list" });
  }

  try {
    let result = await search(effectiveUserId, q.trim());
    if (userId && result.transactions?.length === 0) {
      result = await search(DEMO_USER_ID, q.trim());
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error("[nl-search]", err);
    return NextResponse.json({ transactions: [], answer: "Search failed.", metric: "list" });
  }
}
