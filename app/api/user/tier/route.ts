import { NextResponse } from "next/server";
import { loadClerkAuth } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function GET() {
  const clerkAuth = await loadClerkAuth();
  if (!clerkAuth.ok) {
    return NextResponse.json(
      { error: "Service temporarily unavailable" },
      { status: 503 }
    );
  }
  if (!clerkAuth.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getSupabaseAdmin();
  const { data } = await db
    .from("users")
    .select("tier")
    .eq("clerk_user_id", clerkAuth.userId)
    .single();

  return NextResponse.json({ tier: data?.tier ?? "free" }, {
    headers: { "Cache-Control": "private, max-age=300, stale-while-revalidate=600" },
  });
}
