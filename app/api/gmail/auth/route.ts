import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getAuthUrl } from "@/lib/google-auth";

export async function GET() {
  const { userId } = await auth();
  console.log("[Gmail Auth] Starting OAuth flow for user:", userId);

  if (!userId) {
    console.error("[Gmail Auth] No userId");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const authUrl = getAuthUrl(userId);
    console.log("[Gmail Auth] Generated auth URL:", authUrl);
    return NextResponse.json({ authUrl });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to generate auth URL";
    console.error("[Gmail Auth] Failed to generate URL:", e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
