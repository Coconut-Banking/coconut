export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { getSplitwiseConfig } from "@/lib/splitwise";

export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { clientId } = getSplitwiseConfig();
  if (!clientId) {
    return NextResponse.json({ configured: false, connected: false });
  }

  const db = getSupabase();
  const { data } = await db
    .from("splitwise_tokens")
    .select("created_at")
    .eq("clerk_user_id", userId)
    .maybeSingle();

  return NextResponse.json({
    configured: true,
    connected: !!data,
    connectedAt: data?.created_at ?? null,
  });
}

/** Disconnect — delete the stored token. */
export async function DELETE() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getSupabase();
  await db.from("splitwise_tokens").delete().eq("clerk_user_id", userId);

  return NextResponse.json({ ok: true });
}
