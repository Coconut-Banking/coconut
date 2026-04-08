export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";

/**
 * GET /api/stripe/connect/receiver-status?receiverMemberId=xxx
 * Checks whether a group member (receiver) has completed Stripe Connect onboarding.
 * Used by the Pay screen to show a note when funds won't be directly transferred.
 */
export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const receiverMemberId = req.nextUrl.searchParams.get("receiverMemberId");
  if (!receiverMemberId) {
    return NextResponse.json({ error: "receiverMemberId required" }, { status: 400 });
  }

  const db = getSupabase();

  const { data: member } = await db
    .from("group_members")
    .select("user_id")
    .eq("id", receiverMemberId)
    .maybeSingle();

  if (!member?.user_id) {
    return NextResponse.json({ payoutsEnabled: false });
  }

  const { data: connectAccount } = await db
    .from("stripe_connected_accounts")
    .select("onboarding_complete, payouts_enabled")
    .eq("clerk_user_id", member.user_id)
    .maybeSingle();

  return NextResponse.json(
    { payoutsEnabled: connectAccount?.onboarding_complete && connectAccount?.payouts_enabled },
    { headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=30" } }
  );
}
