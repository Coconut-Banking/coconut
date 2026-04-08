export const dynamic = "force-dynamic";
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
  if (process.env.ENABLE_DEBUG_ENDPOINTS !== "true") {
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
 
  const admin = getSupabaseAdmin();

  // Parallelize RLS-scoped query + admin count (independent after token is ready)
  const [
    { data: txRows, error: txErr },
    { count: adminUserTxCount },
  ] = await Promise.all([
    db.from("transactions").select("id, clerk_user_id").limit(25),
    admin.from("transactions").select("id", { count: "exact", head: true }).eq("clerk_user_id", userId),
  ]);

  if (txErr) {
    return NextResponse.json(
      { ok: false, userId, step: "transactions_select", error: txErr.message },
      { status: 500 }
    );
  }

  const userIds = Array.from(new Set((txRows ?? []).map((r) => r.clerk_user_id)));
 
  return NextResponse.json({
    ok: true,
    clerkUserId: userId,
    rlsVisibleUserIds: userIds,
    rlsSampleCount: (txRows ?? []).length,
    adminCountForUser: adminUserTxCount ?? null,
    rlsLooksCorrect: userIds.length === 0 ? true : (userIds.length === 1 && userIds[0] === userId),
  });
}

