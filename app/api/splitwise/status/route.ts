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

  const [tokenRes, importCountRes] = await Promise.all([
    db
      .from("splitwise_tokens")
      .select("created_at")
      .eq("clerk_user_id", userId)
      .maybeSingle(),
    db
      .from("groups")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", userId)
      .eq("source", "splitwise"),
  ]);

  const data = tokenRes.data;
  const importCount = importCountRes.count ?? 0;

  return NextResponse.json(
    {
      configured: true,
      /** Stored OAuth token exists (Splitwise authorized Coconut on the server). */
      connected: !!data,
      connectedAt: data?.created_at ?? null,
      /** Groups created from Splitwise import — 0 if you authorized but never imported or cleared data. */
      importedSplitwiseGroupCount: importCount,
    },
    { headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=300" } }
  );
}

/** Disconnect — delete the stored token. */
export async function DELETE() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getSupabase();
  await db.from("splitwise_tokens").delete().eq("clerk_user_id", userId);

  return NextResponse.json({ ok: true });
}
