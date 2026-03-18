import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin, getSupabaseForUser } from "@/lib/supabase";
 
/**
 * GET /api/debug/rls
 * Dev-only sanity check that Supabase RLS works with Clerk JWT.
 *
 * - Uses anon key + Clerk JWT (template: "supabase") and queries WITHOUT a clerk_user_id filter.
 * - If RLS is configured correctly, it should only return rows for the requesting user.
 */
export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
 
  const { userId, getToken } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
 
  const token = await getToken({ template: "supabase" });
  const db = getSupabaseForUser(token);
  if (!db) {
    return NextResponse.json(
      { error: "Missing anon key or session token" },
      { status: 500 }
    );
  }
 
  // RLS check: query WITHOUT clerk_user_id filter. Should still only show the current user.
  const { data: txRows, error: txErr } = await db
    .from("transactions")
    .select("id, clerk_user_id")
    .limit(25);
 
  if (txErr) {
    return NextResponse.json(
      { ok: false, userId, step: "transactions_select", error: txErr.message },
      { status: 500 }
    );
  }
 
  const userIds = Array.from(new Set((txRows ?? []).map((r) => r.clerk_user_id)));
 
  // Minimal comparison: admin count for this user (not a security control; only for sanity).
  const admin = getSupabaseAdmin();
  const { count: adminUserTxCount } = await admin
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("clerk_user_id", userId);
 
  return NextResponse.json({
    ok: true,
    clerkUserId: userId,
    rlsVisibleUserIds: userIds,
    rlsSampleCount: (txRows ?? []).length,
    adminCountForUser: adminUserTxCount ?? null,
    rlsLooksCorrect: userIds.length === 0 ? true : (userIds.length === 1 && userIds[0] === userId),
  });
}

