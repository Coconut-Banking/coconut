export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getAuthUrl } from "@/lib/google-auth";
import { rateLimit } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  console.log("[Gmail Auth] Starting OAuth flow for user:", userId);

  if (!userId) {
    console.error("[Gmail Auth] No userId");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = rateLimit(`gmail-auth:${userId}`, 30, 60_000);
  if (!rl.success) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  try {
    const redirect = request.nextUrl.searchParams.get("redirect") || undefined;
    const authUrl = getAuthUrl(userId, redirect);
    console.log("[Gmail Auth] Generated auth URL:", authUrl);
    return NextResponse.json({ authUrl });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to generate auth URL";
    console.error("[Gmail Auth] Failed to generate URL:", e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
