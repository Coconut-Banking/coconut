export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";

async function resolveUserId(req: NextRequest): Promise<string | null> {
  const adminKey = req.headers.get("x-admin-key");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const adminUserId = req.nextUrl.searchParams.get("user_id");
  if (adminKey && serviceKey && adminKey === serviceKey && adminUserId) return adminUserId;
  const { userId } = await auth();
  return userId;
}
import {
  getEffectiveToken,
  resolveGroupByName,
  syncMirrorGroup,
} from "@/lib/splitwise-mirror-debug";

/**
 * POST /api/debug/splitwise-mirror/sync?group_name=Seattle
 *
 * Fetches expenses from the real Splitwise group added since the last clone/sync
 * and copies them to the mirror group.
 *
 * Requires the mirror to already exist (run clone first).
 * Only available when ENABLE_DEBUG_ENDPOINTS=true.
 */
export async function POST(req: NextRequest) {
  if (process.env.ENABLE_DEBUG_ENDPOINTS !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const userId = await resolveUserId(req);
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
    const result = await syncMirrorGroup(db, token, userId, resolved);

    return NextResponse.json({
      ok: true,
      groupName: resolved.coconutGroupName,
      realSwGroupId: resolved.realSwGroupId,
      ...result,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[debug/splitwise-mirror/sync]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
