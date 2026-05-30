export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { debugEndpointDisabledResponse } from "@/lib/debug-guard";

/**
 * GET /api/debug/me
 * Returns your Clerk user ID when authenticated.
 * Requires ENABLE_DEBUG_ENDPOINTS=true.
 */
export async function GET() {
  const disabled = debugEndpointDisabledResponse();
  if (disabled) return disabled;
  const { userId } = await auth();
  return NextResponse.json(
    { userId: userId ?? null },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
