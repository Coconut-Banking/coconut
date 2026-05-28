export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { verifyCollectLinkToken } from "@/lib/collect-link-token";
import { getSupabase } from "@/lib/supabase";

/**
 * POST /api/receipt/collect/[token]/join
 * Public — guest types their name and joins the bill (no pre-added group roster).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params;
  const verified = verifyCollectLinkToken(decodeURIComponent(raw));
  if (!verified.valid) {
    const status = verified.reason === "expired" ? 410 : 400;
    return NextResponse.json({ error: "Invalid or expired link" }, { status });
  }

  let body: { displayName?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const displayName = body.displayName?.trim().slice(0, 80);
  if (!displayName) return NextResponse.json({ error: "Name required" }, { status: 400 });

  const db = getSupabase();
  const { data: session } = await db
    .from("collect_sessions")
    .select("id, group_id, status")
    .eq("id", verified.payload.sessionId)
    .maybeSingle();

  if (!session || session.status !== "open") {
    return NextResponse.json({ error: "Collection closed" }, { status: 404 });
  }

  const key = displayName.toLowerCase();
  const { data: existingMembers } = await db
    .from("group_members")
    .select("id, display_name")
    .eq("group_id", session.group_id);

  const existing = (existingMembers ?? []).find(
    (m) => (m.display_name ?? "").toLowerCase().trim() === key,
  );

  let memberId = existing?.id;
  if (!memberId) {
    const { data: created, error: memberErr } = await db
      .from("group_members")
      .insert({
        group_id: session.group_id,
        display_name: displayName,
        user_id: null,
        email: null,
      })
      .select("id")
      .single();

    if (memberErr || !created) {
      console.error("[collect-join] member:", memberErr);
      return NextResponse.json({ error: "Could not join bill" }, { status: 500 });
    }
    memberId = created.id;
  }

  await db.from("receipt_collect_participants").upsert(
    {
      collect_session_id: session.id,
      member_id: memberId,
      display_name: displayName,
      status: "invited",
    },
    { onConflict: "collect_session_id,member_id" },
  );

  return NextResponse.json({ memberId, displayName });
}
