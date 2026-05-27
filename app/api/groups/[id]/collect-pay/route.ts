export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { canAccessGroup } from "@/lib/group-access";
import { createCollectLinkToken, collectPublicUrl } from "@/lib/collect-link-token";

const COLLECT_HOURS = 24;

/**
 * POST /api/groups/[id]/collect-pay
 * Fixed-amount "collect at table" — guests pick name then get a personal pay link.
 * Body: { amount, currency?, label? }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: groupId } = await params;
  let body: { amount?: number; currency?: string; label?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Valid amount required" }, { status: 400 });
  }

  const allowed = await canAccessGroup(userId, groupId);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = getSupabase();
  const { data: hostMember } = await db
    .from("group_members")
    .select("id")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!hostMember) {
    return NextResponse.json({ error: "You are not a member of this group" }, { status: 400 });
  }

  const currency = (body.currency ?? "USD").toUpperCase();
  const expiresAt = new Date(Date.now() + COLLECT_HOURS * 60 * 60 * 1000).toISOString();

  const { data: session, error } = await db
    .from("collect_sessions")
    .insert({
      group_id: groupId,
      host_clerk_user_id: userId,
      session_type: "pay",
      payload: {
        amount: Math.round(amount * 100) / 100,
        currency,
        receiverMemberId: hostMember.id,
        label: body.label ?? "Settle up",
      },
      status: "open",
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (error || !session) {
    console.error("[collect-pay]", error);
    return NextResponse.json({ error: "Could not start collection" }, { status: 500 });
  }

  const token = createCollectLinkToken(session.id);
  return NextResponse.json({
    sessionId: session.id,
    token,
    collectUrl: collectPublicUrl(token, "collect"),
    expiresAt,
  });
}
