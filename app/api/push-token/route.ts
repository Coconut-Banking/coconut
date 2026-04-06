import { NextRequest, NextResponse } from "next/server";
import { loadClerkAuth } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

interface PushTokenBody {
  token: string;
  platform: string;
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

  let body: PushTokenBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  const { token, platform } = body;

  if (!token || typeof token !== "string") {
    return NextResponse.json(
      { error: "token is required" },
      { status: 400 }
    );
  }
  if (!platform || typeof platform !== "string") {
    return NextResponse.json(
      { error: "platform is required" },
      { status: 400 }
    );
  }

  const db = getSupabaseAdmin();

  const row: Record<string, string> = {
    clerk_user_id: clerkAuth.userId,
    token,
    platform,
    updated_at: new Date().toISOString(),
  };

  let { error } = await db
    .from("push_tokens")
    .upsert(row, { onConflict: "clerk_user_id,token" });

  if (error?.message?.includes("platform")) {
    const { platform: _p, ...rowWithoutPlatform } = row;
    void _p;
    ({ error } = await db
      .from("push_tokens")
      .upsert(rowWithoutPlatform, { onConflict: "clerk_user_id,token" }));
  }

  if (error) {
    console.error("[push-token] upsert failed:", error.message);
    return NextResponse.json(
      { error: "Failed to store push token" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
