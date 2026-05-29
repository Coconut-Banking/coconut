export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { getSplitwiseConfig } from "@/lib/splitwise";
import { getSplitwiseImportStatus } from "@/lib/splitwise-import-status";

export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { clientId } = getSplitwiseConfig();
  const db = getSupabase();
  const status = await getSplitwiseImportStatus(db, userId, !!clientId);

  return NextResponse.json(status, {
    headers: { "Cache-Control": "no-store, max-age=0" },
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
