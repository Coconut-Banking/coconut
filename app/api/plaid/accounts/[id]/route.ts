export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getEffectiveUserId } from "@/lib/demo";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const [userId, { id }, body] = await Promise.all([
    getEffectiveUserId(),
    params,
    request.json(),
  ]);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const nickname = body.nickname;

  if (typeof nickname !== "string" && nickname !== null) {
    return NextResponse.json({ error: "nickname must be a string or null" }, { status: 400 });
  }

  const db = getSupabase();

  // Verify account belongs to user
  const { data: account } = await db
    .from("accounts")
    .select("id")
    .eq("id", id)
    .eq("clerk_user_id", userId)
    .maybeSingle();

  if (!account) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const trimmed = nickname ? nickname.trim().slice(0, 100) : null;

  const { error } = await db
    .from("accounts")
    .update({ nickname: trimmed })
    .eq("id", id)
    .eq("clerk_user_id", userId);

  if (error) {
    console.error("[accounts] nickname update error:", error);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, nickname: trimmed });
}
