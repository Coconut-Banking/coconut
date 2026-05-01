import { NextRequest, NextResponse } from "next/server";
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
  const { data, error } = await db
    .from("users")
    .select("tier")
    .eq("clerk_user_id", clerkAuth.userId)
    .single();

  if (error) {
    console.error("[user/tier] GET failed:", error.message);
    return NextResponse.json({ error: "Failed to fetch tier" }, { status: 500 });
  }

  return NextResponse.json({ tier: data?.tier ?? "free" }, {
    headers: { "Cache-Control": "private, max-age=300, stale-while-revalidate=600" },
  });
}

export async function POST(req: NextRequest) {
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

  let body: { tier?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const tier = body.tier === "pro" ? "pro" : "free";

  const db = getSupabaseAdmin();
  const { error } = await db
    .from("users")
    .update({ tier })
    .eq("clerk_user_id", clerkAuth.userId);

  if (error) {
    console.error("[user/tier] POST failed:", error.message);
    return NextResponse.json({ error: "Failed to update tier" }, { status: 500 });
  }

  return NextResponse.json({ tier });
}
