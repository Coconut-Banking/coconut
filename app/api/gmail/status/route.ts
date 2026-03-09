import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getGmailStatus } from "@/lib/google-auth";

export async function GET() {
  const { userId } = await auth();
  console.log("[Gmail Status API] Checking status for user:", userId);

  if (!userId) {
    console.error("[Gmail Status API] No userId");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = await getGmailStatus(userId);
  console.log("[Gmail Status API] Status result:", status);

  return NextResponse.json(status);
}
