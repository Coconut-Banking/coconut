export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { verifyCollectLinkToken } from "@/lib/collect-link-token";
import { getSupabase } from "@/lib/supabase";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params;
  const token = decodeURIComponent(raw);
  const verified = verifyCollectLinkToken(token);
  if (!verified.valid) {
    const status = verified.reason === "expired" ? 410 : 400;
    return NextResponse.json({ error: "Invalid or expired link" }, { status });
  }

  const db = getSupabase();
  const { data: session } = await db
    .from("collect_sessions")
    .select("id, group_id, session_type, status, payload, expires_at")
    .eq("id", verified.payload.sessionId)
    .maybeSingle();

  if (!session || session.status !== "open") {
    return NextResponse.json({ error: "Session not available" }, { status: 404 });
  }

  const { data: members } = await db
    .from("group_members")
    .select("id, display_name, user_id")
    .eq("group_id", session.group_id)
    .order("display_name");

  return NextResponse.json({
    sessionId: session.id,
    groupId: session.group_id,
    sessionType: session.session_type,
    members: (members ?? []).map((m) => ({
      id: m.id,
      displayName: m.display_name,
    })),
  });
}
