export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import {
  getEffectiveToken,
  resolveGroupByName,
  verifyMirrorParity,
} from "@/lib/splitwise-mirror-debug";

/**
 * GET /api/debug/splitwise-mirror/verify?group_name=Seattle
 *
 * Compares the simplified_debts of the real Splitwise group against the mirror.
 * Returns parity status and per-member discrepancies if balances differ.
 *
 * Requires the mirror to already exist (run clone first).
 * Only available when ENABLE_DEBUG_ENDPOINTS=true.
 */
export async function GET(req: NextRequest) {
  if (process.env.ENABLE_DEBUG_ENDPOINTS !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const groupName = req.nextUrl.searchParams.get("group_name");
  if (!groupName) {
    return NextResponse.json(
      { error: "Missing required query param: group_name" },
      { status: 400 }
    );
  }

  try {
    const db = getSupabase();
    const token = await getEffectiveToken(db, userId);
    const resolved = await resolveGroupByName(db, token, groupName);
    const result = await verifyMirrorParity(db, token, userId, resolved);

    return NextResponse.json({
      ok: true,
      groupName: resolved.coconutGroupName,
      ...result,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[debug/splitwise-mirror/verify]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
