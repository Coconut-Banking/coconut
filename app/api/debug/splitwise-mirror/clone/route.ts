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
  cloneMirrorGroup,
} from "@/lib/splitwise-mirror-debug";

/**
 * POST /api/debug/splitwise-mirror/clone?group_name=Seattle
 *
 * Finds the named Splitwise-linked coconut group, creates (or finds) a
 * "Mirror <Name>" Splitwise group, and copies the 40 most recent expenses.
 *
 * Idempotent — re-running will find the existing mirror and re-copy expenses on top.
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

  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10), 1), 200) : 40;

  try {
    const db = getSupabase();
    const token = await getEffectiveToken(db, userId);
    const resolved = await resolveGroupByName(db, token, groupName);
    const result = await cloneMirrorGroup(db, token, userId, resolved, limit);

    return NextResponse.json({
      ok: true,
      groupName: resolved.coconutGroupName,
      realSwGroupId: resolved.realSwGroupId,
      ...result,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[debug/splitwise-mirror/clone]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
