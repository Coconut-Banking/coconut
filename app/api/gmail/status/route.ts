export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getGmailStatus } from "@/lib/google-auth";
import { getEffectiveUserId } from "@/lib/demo";

export async function GET() {
  const userId = await getEffectiveUserId();
  console.log("[Gmail Status API] Checking status for user:", userId);

  if (!userId) {
    console.error("[Gmail Status API] No userId");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = await getGmailStatus(userId);
  console.log("[Gmail Status API] Status result:", status);

  return NextResponse.json(status);
}
