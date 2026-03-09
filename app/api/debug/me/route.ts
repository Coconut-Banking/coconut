import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

/**
 * GET /api/debug/me
 * Returns your Clerk user ID when authenticated. Use this to set SKIP_AUTH_DEV_USER_ID.
 * Remove or protect this route in production.
 */
export async function GET() {
  const { userId } = await auth();
  return NextResponse.json({ userId: userId ?? null });
}
