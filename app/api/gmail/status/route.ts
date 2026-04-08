export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getGmailStatus } from "@/lib/google-auth";
import { getEffectiveUserId } from "@/lib/demo";

export async function GET() {
  const userId = await getEffectiveUserId();

  if (!userId) {
    console.error("[Gmail Status API] No userId");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = await getGmailStatus(userId);

  return NextResponse.json(status, {
    headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=300" },
  });
}
