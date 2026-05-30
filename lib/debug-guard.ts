import { NextResponse } from "next/server";

/**
 * Debug/diagnostic API routes must set ENABLE_DEBUG_ENDPOINTS=true.
 * In production this must remain unset so routes return 404.
 */
export function debugEndpointDisabledResponse(): NextResponse | null {
  if (process.env.ENABLE_DEBUG_ENDPOINTS === "true") {
    return null;
  }
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
